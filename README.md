# TinDARhan

Point-of-sale system for the DAR Batangas ARBO shop, with a Node.js +
Express backend and a PostgreSQL database, built for multiple devices to
share the same live inventory, sales, and settings.

## Default login

| Username | Password  |
|----------|-----------|
| `DAR`    | `TINDAHAN` |

Change this after your first login by updating the row in the `users`
table (or ask for a "change password" feature to be added).

## Running locally

```bash
npm install
cp .env.example .env
# edit .env and set DATABASE_URL to a local PostgreSQL connection string
npm start
```

The app will be available at `http://localhost:3000`.

## Deploying on Railway

1. Create a new Railway project and deploy this repository as a service.
2. In the **same project**, click "New" -> "Database" -> "Add PostgreSQL".
   Railway automatically injects `DATABASE_URL` into every other service
   in the same project — you do not need to copy/paste it yourself.
3. Redeploy the app service if it was already running before the
   database was added, so it picks up the new environment variable.
4. On first boot, the app creates all tables automatically and seeds:
   - the default `DAR` / `TINDAHAN` login,
   - 12 starter inventory items with sample ARBO farm names.

If you see `[FATAL] DATABASE_URL is not set` in the logs, the PostgreSQL
service is either missing or not in the same Railway project as the app.

## GCash QR code

From the sidebar, click **GCash QR Code** to upload a photo/screenshot of
your shop's GCash QR. It's stored in the database (not on disk), so every
device sees the same QR immediately. It automatically appears at checkout
whenever "GCash" is selected as the payment method.

## Pay Later (Utang)

Selecting **Pay Later (Utang)** at checkout only requires the customer's
name — no amount-paid entry. The sale is recorded as unsettled. On the
Sales Reports page, click **Mark Paid** next to a pending Pay Later sale
once the customer settles their balance; this can be undone with the undo
button next to a paid entry if it was marked by mistake.

## Sales Reports export

**Export Excel** on the Sales Reports page produces a `.xlsx` workbook
built to match the official DAR Sales & Inventory Report form exactly —
same sheet names, headings, cell borders, merged signature blocks, and
column widths, with every amount formatted with 2 decimal places
(₱#,##0.00):

1. **Product Inv** — ARBO name, product name, unit price, beginning
   inventory, units sold, and ending inventory, with a bordered table and
   a highlighted grand-total row.
2. **Daily Sales** — one row per product sold, an end-of-day totals row,
   and the Cash Flow / Sales Monitoring section (Opening Cash, Cash
   Sales, GCash Sales, Expected Closing Cash, Cash Over/Short) with the
   same formulas as the paper form.
3. **Sales Summary** — total sales per day of the week for the selected
   date range.

The export is built client-side with [ExcelJS](https://github.com/exceljs/exceljs)
(loaded from a CDN), which writes real borders, bold headers, and number
formats into the file — not just plain values — so it opens looking like
a finished form rather than a raw data dump.

## Danger Zone

The Sales Reports page has a **Delete All Reports** action that
permanently clears sales history and resets receipt numbering. It
requires typing `DELETE` to confirm, and the server independently
verifies the same confirmation phrase before performing the deletion.

## API summary

| Method | Route                        | Description                          |
|--------|------------------------------|---------------------------------------|
| GET    | `/api/items`                 | List inventory items                  |
| POST   | `/api/items`                 | Add an item                           |
| PUT    | `/api/items/:id`             | Update an item                        |
| DELETE | `/api/items/:id`             | Delete an item                        |
| GET    | `/api/sales`                 | List sales (optional `from`/`to`)     |
| POST   | `/api/sales`                 | Record a new sale                     |
| DELETE | `/api/sales`                 | Delete all sales (`{confirm:"DELETE"}`)|
| POST   | `/api/sales/:id/settle`      | Mark a Pay Later sale as paid         |
| POST   | `/api/sales/:id/unsettle`    | Revert a Pay Later sale to pending    |
| GET    | `/api/settings/:key`         | Read a setting (e.g. `gcash_qr`)      |
| PUT    | `/api/settings/:key`         | Write a setting                       |
| POST   | `/api/login`                 | Verify username/password              |

## Live sync

Every connected device polls the server every 6 seconds while its tab is
visible and the user is logged in, so a sale, item change, or Pay Later
settlement made on one device shows up on all the others shortly after.
