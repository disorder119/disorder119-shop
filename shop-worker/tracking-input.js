// Pure input parsing: URLs are inspected locally and are never requested.
// Keep this implementation in sync with disorder119-admin/tracking-input.js.
const CARRIERS = [
  { name: "DHL", hosts: ["dhl.de", "www.dhl.de", "dhl.com", "www.dhl.com"], keys: ["piececode", "trackingnumber", "tracking-id"] },
  { name: "Hermes", hosts: ["myhermes.de", "www.myhermes.de", "hermesworld.com", "www.hermesworld.com"], keys: ["trackid", "trackingnumber"] },
  { name: "DPD", hosts: ["dpd.de", "www.dpd.de", "tracking.dpd.de", "dpd.com", "www.dpd.com", "tracking.dpd.com", "tracking.dpdgroup.com"], keys: ["parcelnumber", "parcelno"] },
  { name: "GLS", hosts: ["gls-group.com", "www.gls-group.com", "gls-group.eu", "www.gls-group.eu", "gls-pakete.de", "www.gls-pakete.de"], keys: ["match"] },
  { name: "UPS", hosts: ["ups.com", "www.ups.com"], keys: ["tracknum", "tracknums"] },
  { name: "FedEx", hosts: ["fedex.com", "www.fedex.com"], keys: ["trknbr"] },
  { name: "La Poste", hosts: ["laposte.fr", "www.laposte.fr", "colissimo.fr", "www.colissimo.fr"], keys: ["code"] },
  { name: "Chronopost", hosts: ["chronopost.fr", "www.chronopost.fr"], keys: ["listenumeroslt"] },
  { name: "Mondial Relay", hosts: ["mondialrelay.fr", "www.mondialrelay.fr", "mondialrelay.de", "www.mondialrelay.de", "mondialrelay.be", "www.mondialrelay.be"], keys: ["numeroexpedition", "expedition"] },
  { name: "", hosts: ["17track.net", "www.17track.net", "t.17track.net", "m.17track.net"], keys: ["nums"] }
];

function inputError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function normalizeNumber(value) {
  const number = String(value).trim().replace(/[ \t]/g, "").toUpperCase();
  // Four characters preserves existing short IDs; URLs and punctuation never qualify.
  if (!/^[A-Z0-9]{4,40}$/.test(number)) throw inputError("TRACKING_NUMBER_INVALID");
  return number;
}

function guessCarrier(number) {
  return /^1Z[A-Z0-9]{16}$/.test(number) ? "UPS" : "";
}

function addNumbers(values, value, carrier) {
  const pieces = String(value).split(/[,;|\r\n]+/);
  for (const piece of pieces) {
    if (!piece.trim()) throw inputError("TRACKING_NUMBER_INVALID");
    const tokens = piece.trim().split(/[ \t]+/);
    if (tokens.length > 1 && tokens.every(function (token) { return /^[A-Za-z0-9]{6,40}$/.test(token) && /[0-9]/.test(token); })) {
      throw inputError("TRACKING_INPUT_AMBIGUOUS");
    }
    const number = normalizeNumber(piece);
    values.push({ trackingNumber: number, carrier: carrier || guessCarrier(number) });
  }
}

function readTrackingUrl(value) {
  let url;
  try { url = new URL(value); } catch (_) { throw inputError("TRACKING_INPUT_UNSUPPORTED"); }
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) {
    throw inputError("TRACKING_INPUT_UNSUPPORTED");
  }
  const carrier = CARRIERS.find(function (item) { return item.hosts.includes(url.hostname.toLowerCase()); });
  if (!carrier) throw inputError("TRACKING_INPUT_UNSUPPORTED");
  const values = [];
  const queries = [url.searchParams];
  if (!carrier.name && url.hash) queries.push(new URLSearchParams(url.hash.slice(1)));
  for (const query of queries) {
    for (const entry of query) {
      if (carrier.keys.includes(entry[0].toLowerCase())) addNumbers(values, entry[1], carrier.name);
    }
  }
  // This is DPD's published parcel-status route, rather than an arbitrary numeric path.
  if (!values.length && carrier.name === "DPD") {
    const path = /^\/status\/[a-z]{2}_[a-z]{2}\/parcel\/([A-Z0-9]{4,40})\/?$/i.exec(url.pathname);
    if (path) addNumbers(values, path[1], carrier.name);
  }
  if (!values.length) throw inputError("TRACKING_INPUT_UNSUPPORTED");
  return values;
}

function finish(values, text) {
  const unique = new Map();
  for (const value of values) {
    const previous = unique.get(value.trackingNumber);
    if (!previous || (!previous.carrier && value.carrier)) unique.set(value.trackingNumber, value);
  }
  if (unique.size > 1) throw inputError("TRACKING_INPUT_AMBIGUOUS");
  if (!unique.size) throw inputError("TRACKING_NUMBER_INVALID");
  const value = unique.values().next().value;
  return { trackingNumber: value.trackingNumber, carrier: value.carrier, platform: /\bvinted\b/i.test(text) ? "Vinted" : "" };
}

function labelledNumbers(text) {
  const values = [];
  const labels = /\b(?:sendungs\s*(?:nummer|[- ]?id)|tracking\s*(?:number|nummer|[- ]?id))\s*[:=#-]?\s*/gi;
  let match;
  while ((match = labels.exec(text))) {
    const tail = text.slice(labels.lastIndex);
    if (tail.startsWith("<tracking link>")) continue;
    const line = tail.split(/[\r\n.!?<>]/, 1)[0].trim();
    // Punctuation inside an ID must not silently turn a prefix into a valid number.
    if (/^[.!?][A-Za-z0-9]/.test(tail.slice(tail.indexOf(line) + line.length))) throw inputError("TRACKING_NUMBER_INVALID");
    const chunks = line.split(/[,;]/);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index].trim();
      const beginning = /^[A-Za-z0-9]+(?:[ \t]+[A-Za-z0-9]+)*/.exec(chunk);
      if (!beginning) throw inputError("TRACKING_NUMBER_INVALID");
      if (/^[\/_-]/.test(chunk.slice(beginning[0].length))) throw inputError("TRACKING_NUMBER_INVALID");
      const tokens = beginning[0].split(/[ \t]+/);
      // A sentence after a comma is not another tracking ID.
      if (index && !/[0-9]/.test(tokens[0])) break;
      const parts = [];
      for (const token of tokens) {
        // Short alphabetic groups occur in formatted UPS IDs; sentence words do not.
        if (parts.length && !/[0-9]/.test(token) && token.length > 2) break;
        parts.push(token);
      }
      addNumbers(values, parts.join(" "), "");
    }
  }
  return values;
}

function parseTrackingInput(value) {
  if (typeof value !== "string" && typeof value !== "number") throw inputError("TRACKING_NUMBER_INVALID");
  const text = String(value).trim();
  if (!text || text.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    throw inputError("TRACKING_NUMBER_INVALID");
  }
  // Every pasted URL must be recognised, including URLs embedded in a message.
  const urls = text.match(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+|\b(?:javascript|data)\s*:[^\s<>"']*|(?<!:)\/\/[^\s<>"']+/gi) || [];
  const values = [];
  if (urls.length) {
    for (const raw of urls) {
      const url = raw.replace(/[),.!?\]}]+$/, "");
      values.push.apply(values, readTrackingUrl(url));
    }
    values.push.apply(values, labelledNumbers(text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s<>"']+/gi, "<tracking link>")));
    addStandaloneLines(values, text);
    return finish(values, text);
  }
  if (/(?:https?|javascript|data)\s*:/i.test(text) || /\b(?:www\.|vinted\.[a-z]{2,})/i.test(text)) {
    throw inputError("TRACKING_INPUT_UNSUPPORTED");
  }
  const labelled = labelledNumbers(text);
  if (labelled.length) {
    addStandaloneLines(labelled, text);
    return finish(labelled, text);
  }
  // Newlines and commas are distinct numbers; spaces inside one ID are formatting.
  addNumbers(values, text, "");
  return finish(values, text);
}

function addStandaloneLines(values, text) {
  for (const line of text.split(/[\r\n]+/)) {
    if (/^[A-Za-z0-9 \t]+$/.test(line.trim()) && /[0-9]/.test(line)) addNumbers(values, line, "");
  }
}

function trackingUrlFor(value, carrier) {
  const number = encodeURIComponent(normalizeNumber(value));
  const name = String(carrier || "").trim().toLowerCase().replace(/[\s._-]+/g, "");
  if (name === "dhl" || name === "dhlpaket" || name === "dhlparcel") return "https://www.dhl.de/de/privatkunden/dhl-sendungsverfolgung.html?piececode=" + number;
  if (name === "hermes") return "https://www.myhermes.de/empfangen/sendungsverfolgung/?TrackID=" + number;
  if (name === "dpd") return "https://tracking.dpd.de/status/de_DE/parcel/" + number;
  if (name === "gls") return "https://gls-group.com/DE/de/paketverfolgung?match=" + number;
  if (name === "ups") return "https://www.ups.com/track?loc=de_DE&tracknum=" + number;
  if (name === "fedex") return "https://www.fedex.com/fedextrack/?trknbr=" + number;
  if (name === "laposte" || name === "colissimo") return "https://www.laposte.fr/outils/suivre-vos-envois?code=" + number;
  if (name === "chronopost") return "https://www.chronopost.fr/fr/chrono_suivi_search?listeNumerosLT=" + number;
  if (name === "mondialrelay") return "https://www.mondialrelay.fr/suivi-de-colis?numeroExpedition=" + number;
  return "https://t.17track.net/de#nums=" + number;
}

export { parseTrackingInput, trackingUrlFor };
