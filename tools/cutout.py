"""
Reusable studio-backdrop cutout tool for Disorder119 product photos.

Removes the gray studio backdrop while preserving garment fabric and mannequin,
even in tight detail/label close-ups where the backdrop is a small fraction of
the frame. Designed to be run in batch across many items without per-image
tuning.

Pipeline:
1. Build a foreground/background color model from the item's own main photo
   (full-body shot), where a general-purpose segmenter (u2net) reliably finds
   the garment silhouette.
2. Classify the target photo's pixels against that color model, keep only the
   part of "background" that's actually connected to the frame border (a
   backdrop island in the middle of the frame is impossible; that's fabric
   that happens to be a similar color).
3. Feed that rough estimate into OpenCV GrabCut (graph-cut energy
   minimization) as a trimap seed, not a final answer - GrabCut resolves the
   ambiguous boundary far more cleanly than raw thresholding + morphology.
4. Safety net: if GrabCut wants to remove a much larger fraction than the
   rough color estimate justified, that means it leaked into real fabric
   (this happens on some close-ups with almost no real backdrop and a lot of
   shadow) - distrust it and fall back to the rough estimate, or to the
   untouched original if even the rough estimate found almost no backdrop.
   Preserving real product detail always wins over a clean-looking cutout.
5. Fill enclosed holes, drop small disconnected specks, save at full
   resolution.

Usage:
    python cutout.py <main_photo.jpg> <target_photo.jpg> <output.webp> [--max-side 1800]

Or import and call `cutout(main_photo_path, target_path, out_path)` directly
for batch use. Returns a dict with `method` telling you which stage the
final result actually came from ("grabcut", "rough_fallback", or
"no_backdrop_skip") - log this when running in bulk so borderline cases can
be spot-checked instead of trusted blindly.

Default max_side is deliberately modest (1200px, quality 82, ~20-30KB/image).
The site's CI runs a Lighthouse mobile-performance floor against whichever
product is first in data/items.json - a batch of oversized detail photos
landing on that one page dropped the score 1 point below the floor and
failed the build even though nothing was functionally wrong. Don't raise
this without checking page weight on that specific product afterward.
"""
import os
import numpy as np
from PIL import Image, ImageOps, ImageFilter
from scipy import ndimage
import cv2
from rembg import remove, new_session

_SESSION = None

MIN_BACKDROP_FRAC = 0.20   # below this, treat the photo as having no *reliably identifiable*
                           # backdrop - shadow-colored fabric folds routinely produce false
                           # readings of 10-17%, so a low bar risks eating real garment detail.
                           # Skipping the cutout (keep the original, ungraded) is always safer
                           # than a wrong one; tuned against a diverse test set, see README.
MAX_GRABCUT_OVERREACH = 1.6  # GrabCut may not remove more than 1.6x the rough estimate


def _session():
    global _SESSION
    if _SESSION is None:
        _SESSION = new_session('u2net')
    return _SESSION


def _load(path):
    return ImageOps.exif_transpose(Image.open(path)).convert('RGB')


def _resize_max(im, max_side):
    w, h = im.size
    scale = max_side / max(w, h)
    if scale >= 1:
        return im
    return im.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)


def build_color_model(main_photo_path, sample_side=700):
    """Sample confident foreground/background colors from a full-body photo
    of the same item, using u2net's silhouette (reliable on full-body shots)."""
    im = _resize_max(_load(main_photo_path), sample_side)
    result = remove(im, session=_session())
    arr = np.asarray(im).astype(float)
    alpha = np.asarray(result)[:, :, 3]
    fg_pixels = arr[alpha > 220]
    bg_pixels = arr[alpha < 20]
    if len(fg_pixels) < 50 or len(bg_pixels) < 50:
        raise ValueError(f"Color model too small (fg={len(fg_pixels)}, bg={len(bg_pixels)}) - "
                          f"is {main_photo_path} really a clean full-body shot?")
    return fg_pixels, bg_pixels


def _mahalanobis(flat, mean, inv_cov):
    d = flat - mean
    return np.einsum('ij,jk,ik->i', d, inv_cov, d)


def rough_background(arr, fg_pixels, bg_pixels):
    """Background = classified-as-background AND connected to the frame
    border (a backdrop 'island' in the middle of the frame is impossible)."""
    h, w, _ = arr.shape
    flat = arr.reshape(-1, 3).astype(float)

    fg_mean = fg_pixels.mean(axis=0)
    fg_cov = np.cov(fg_pixels.T) + np.eye(3) * 8
    bg_mean = bg_pixels.mean(axis=0)
    bg_cov = np.cov(bg_pixels.T) + np.eye(3) * 8
    fg_inv = np.linalg.inv(fg_cov)
    bg_inv = np.linalg.inv(bg_cov)

    d_fg = _mahalanobis(flat, fg_mean, fg_inv).reshape(h, w)
    d_bg = _mahalanobis(flat, bg_mean, bg_inv).reshape(h, w)
    fg_raw = d_fg < d_bg

    fg_clean = ndimage.binary_opening(fg_raw, structure=np.ones((5, 5)))
    bg2 = ~fg_clean
    labeled_bg, _ = ndimage.label(bg2)
    border_labels = set(labeled_bg[0, :]) | set(labeled_bg[-1, :]) | \
        set(labeled_bg[:, 0]) | set(labeled_bg[:, -1])
    border_labels.discard(0)
    return np.isin(labeled_bg, list(border_labels))


def _grabcut(arr, rough_fg):
    h, w = rough_fg.shape
    sure_fg = ndimage.binary_erosion(rough_fg, structure=np.ones((15, 15)))
    sure_bg = ndimage.binary_erosion(~rough_fg, structure=np.ones((3, 3)))

    mask = np.full((h, w), cv2.GC_PR_BGD, dtype=np.uint8)
    mask[rough_fg] = cv2.GC_PR_FGD
    mask[sure_fg] = cv2.GC_FGD
    mask[sure_bg] = cv2.GC_BGD

    bgr = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)
    bgd_model = np.zeros((1, 65), np.float64)
    fgd_model = np.zeros((1, 65), np.float64)
    cv2.grabCut(bgr, mask, None, bgd_model, fgd_model, 8, cv2.GC_INIT_WITH_MASK)
    return (mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD)


def _cleanup(fg, min_component_frac=0.002):
    fg = ndimage.binary_fill_holes(fg)
    labeled, num = ndimage.label(fg)
    if num > 0:
        sizes = ndimage.sum(fg, labeled, range(1, num + 1))
        keep = np.where(sizes > (min_component_frac * fg.size))[0] + 1
        fg = np.isin(labeled, keep)
        fg = ndimage.binary_fill_holes(fg)
    return fg


def cutout(main_photo_path, target_path, out_path, max_side=1200, quality=82):
    fg_pixels, bg_pixels = build_color_model(main_photo_path)

    im = _resize_max(_load(target_path), max_side)
    arr = np.asarray(im)
    h, w, _ = arr.shape
    total = h * w

    rough_bg = rough_background(arr.astype(float), fg_pixels, bg_pixels)
    rough_bg_frac = rough_bg.mean()

    if rough_bg_frac < MIN_BACKDROP_FRAC:
        # essentially no real backdrop in frame - don't risk a cutout at all
        alpha = np.full((h, w), 255, dtype=np.uint8)
        method = 'no_backdrop_skip'
    else:
        fg_final = _grabcut(arr, ~rough_bg)
        fg_final = _cleanup(fg_final)
        grabcut_bg_frac = 1 - fg_final.mean()

        if grabcut_bg_frac > rough_bg_frac * MAX_GRABCUT_OVERREACH:
            # GrabCut decided much more of the frame is background than the
            # color evidence supported - it likely leaked into real fabric.
            # Trust the plainer rough estimate instead.
            fg_final = _cleanup(~rough_bg)
            method = 'rough_fallback'
        else:
            method = 'grabcut'

        alpha = (fg_final.astype(np.uint8)) * 255
        alpha = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(1.0)))

    rgba = np.dstack([arr, alpha])
    Image.fromarray(rgba, 'RGBA').save(out_path, 'WEBP', quality=quality)
    return {
        'out_path': out_path,
        'size': im.size,
        'method': method,
        'rough_bg_frac': round(float(rough_bg_frac), 4),
        'fg_frac': round(float((alpha > 127).mean()), 4),
    }


if __name__ == '__main__':
    import argparse
    p = argparse.ArgumentParser()
    p.add_argument('main_photo')
    p.add_argument('target_photo')
    p.add_argument('output')
    p.add_argument('--max-side', type=int, default=1200)
    args = p.parse_args()
    info = cutout(args.main_photo, args.target_photo, args.output, max_side=args.max_side)
    print(info)
