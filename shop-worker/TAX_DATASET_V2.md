# Complete Shop dataset v2

Private dataset and annual summary routes use `prepareDataset`. Manager 1.27.0
or later is required. The v1 helper remains for compatibility fixtures only.

A transactional D1 batch captures metadata, membership, archived hashes and byte
lengths. Immutable invoice/confirmation originals are fetched by these captured
IDs in pages of at most 80. Later inserts belong to the next snapshot. Missing
or changed originals abort the download without a final manifest/ZIP end record.

The exact shared logo is reversibly substituted in read-only SQL before document
bodies reach Worker memory. Literal reference collisions disable substitution.
One file at a time is verified, compressed and streamed under backpressure.
The ZIP holds metadata, invoice HTML/text, confirmation HTML/text/invoice JSON,
one original PNG and a final manifest with transport/original hashes and counts.
Extract all files together for offline display. Manager restores original embedded
images byte-for-byte before checking archived hashes. No source rows change.

Synthetic validation: 100 orders / 210 cash events produce 1,152,618 ZIP bytes;
1,000 orders / 2,100 events produce 10,850,410 bytes for 399,784,044 restored bytes.
Each order includes an invoice and confirmation. Node export peak JS heap was
about 54 MB under a 96 MB heap setting; total native memory was not measured.
The 1,000-order case uses 38 D1 statements and also passed local Cloudflare
workerd (2025-01-01), taking about 52 seconds. All 5,017 entries pass CRC and
Manager validation. Repeated imports preserve exact totals without duplicates.
Catalog, sales and Vinted tables are unchanged. Equal fees from distinct provider
references are separate cash events. No automatic tax approval occurs.

Safety budgets: 10,000 rows per metadata table, 32 MiB metadata, 60,000 ZIP entries,
512 MiB compressed ZIP. Manager allows 256 MiB transport expansion and 4 GiB
reconstructed originals, maximum 8 MiB per document. Exceeding a budget fails
explicitly, never silently truncates. Hosting plan quotas still apply; local
runtime tests do not establish a production hosting-plan guarantee.

References: https://developers.cloudflare.com/workers/runtime-apis/streams/
and https://developers.cloudflare.com/d1/platform/limits/.
