# Screenshot library and sharing

This is an upcoming feature. The current published release is unchanged.

Each instance has a **Screenshots** tab between Content and Settings. The main
Screenshots section, directly below Browse projects, combines the screenshots
folders of registered instances. It supports search, instance filters, newest or
oldest first, filename ordering, and grouping by month or instance. Thumbnails
load on demand; large collections are displayed in batches. A screenshot can be
opened in a zoomable viewer or saved as a copy. Original game screenshots are
read without modifying their files.

On Friends, the image button immediately before Invite opens the picker. Select
up to ten screenshots, including across different instance filters, and send
them together. Selected screenshots remain highlighted while inspecting another
image. The preview button appears on hover or keyboard focus and has a delayed
tooltip. Reduced-motion preferences disable gallery animations.

## Delivery

Sending creates encrypted local copies and commits the batch to a durable
queue. It does not require the recipient to be online, or Social to already be
running. The queue resumes when Social runs and an authenticated friend
connection is available. Both clients must support screenshot sharing. Pending
transfers can be cancelled, and rejected transfers can be retried from
Screenshots → Deliveries. Source screenshots can subsequently be renamed or
removed without breaking an already queued batch.

Files travel over a separate, bounded QUIC stream using the existing Iroh
endpoint. The sandboxed worker receives no source or destination file paths.
The broker authorizes each stream against an accepted friend, the authenticated
session's transport key, and the previously accepted attachment ID. File size,
hash and AEAD authentication are checked before a received image is exposed.
The sender shows Delivered only after the recipient durably saves a verified
object and returns a receipt. Lost receipts are recovered by attachment ID
without downloading the same completed object again.

Received images appear in **From friends**. Saving a copy explicitly decrypts
the image to the location chosen in the Windows file dialog. Deleting a received
image removes the local encrypted copy; a small receipt record prevents an
ordinary delivery retry from restoring it.

## Encryption and limits

Each attachment uses a fresh AES-256-GCM content key and nonce. Associated data
binds the ciphertext to its attachment ID, sender and recipient. The content key
is shared through the signed, authenticated, encrypted peer control channel.
Both the queue index (including content keys) and received attachment metadata
are protected with Windows DPAPI. The retained image objects contain ciphertext.
Original screenshots in Minecraft's own folder remain ordinary game files.

The versioned ciphertext object format can be carried by a future offline
delivery service. Such a service must store ciphertext only; the control offer
contains a secret content key and **must not be uploaded as a public manifest**.
No server mailbox or asynchronous cloud delivery is implemented here. If the
sender closes Aurum, delivery waits for a later time when both peers are online.

Supported local image formats are PNG, JPEG and WebP, up to 25 MiB and 36 million
pixels per file. A send batch is limited to ten files and 100 MiB. The private
attachment store is bounded to 1 GiB, with additional metadata limits. Completed
outgoing payload copies are discarded after a durable receipt. Interrupted
streams are retried from the start, while the complete queue survives restarts.

Native tests cover instance isolation, path validation, real image thumbnails,
encrypted storage and restart recovery, tampering, duplicate receipts and real
local QUIC streaming. Browser fixtures cover placement, filtering, sorting,
selection limits, previews, both themes and offline queue controls. These local
checks do not constitute a two-network delivery test.
