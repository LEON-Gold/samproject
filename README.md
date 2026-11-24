# SAM: customer app and admin panel (test version)

Node ≥22.5 with SQLite. The only package is `pdfjs-dist`, which reads PDF price lists.

```
npm install
ADMIN_PASS=<password> npm start -- --demo   # --demo adds sample products and customers (test only)
npm test
```

- Customer app: `http://localhost:3300/` (installable PWA)
- Admin panel: `http://localhost:3300/admin/`
- Demo customers: `demo` and `demo2`, both with password `demo1234`
- Data and uploads: `data/` (not in git). Use `DATA_DIR` to move them.

## What it does

- **Customers (shops and agencies):**
  - Log in.
  - Browse products by category, with their own price level.
  - Use a cart to place an order or make a proforma (print or PDF).
  - See festivals and their progress toward each festival.
  - See their invoices and balance.
- **Admin panel:**
  - Overview.
  - Orders: status and returns.
  - Agency report: sales, returns, how often each agency orders, and late agencies.
  - Products and categories.
  - Customers: price level and accounting code.
  - Festivals: poster, description, minimum purchase, Jalali start and end dates, settlement terms.
  - Settings: price levels, currency, proforma footer.
- **File import:**
  - Price list: xlsx, csv or text PDF.
  - Invoices: xlsx or csv.
  - Balances: xlsx or csv.
  - Each import runs in the same steps: read the file, guess the columns, show a preview, then save once someone confirms. Nothing is saved before the preview is approved.
  - Customers in invoice and balance files are matched by the accounting code set on each customer.

## Notes

- Prices are always taken from the server. Prices sent by the browser are ignored.
- A proforma takes today's prices when it becomes an order.
- Old `.xls` files must be saved as `.xlsx` first.
- PDF import works only with text PDFs, not scanned images.

## Demo on GitHub Pages

The demo lives at https://leon-gold.github.io/samproject/ and the admin panel at `/admin/`.

- **No server:** the app runs on `web/demo.js` with sample data, saved only in the visitor's browser.
- **Logins:** customer `demo` / `demo1234`, admin `admin` / `admin1234`. These work in the demo only.
- **Limit:** file import works only on the real server, not in the demo.
- **Update it:** after committing, run `tools/publish-demo.sh`. It pushes `web/` to the `gh-pages` branch.
