# Expenses

A personal expense tracker for iPhone, installed as a Home Screen web app. Amounts are in SGD.

- Add an expense with amount, category, date, description and an optional receipt photo
- Categories match the yearly spreadsheet: Food, Entertainment, PayNow/Paylah, Transport, Cab, Phone Bill, Clothing/Shoe, Others
- Edit or delete any expense by tapping it
- **Spent / Received**: money paid back to you (PayNow from friends, refunds) is entered as Received, shows as
  −$21.30 and reduces your totals, just like the negative amounts in the old spreadsheets
- Dashboard: total for the year, a Jan–Dec chart, and spending by category for a month or the whole year.
  Tap a category to see where the money went (e.g. "Uncle Penyet 6×") and every expense in it
- Eye button (top right) hides every amount as `$****`; the app remembers your choice
- Export a year to Excel (`2026_Expenses.xlsx`) in the same layout as the original spreadsheet: a Summary sheet
  plus one sheet per month with a row per day. Several items on one day become `=5.3+10.2`, one description per line
- Back up everything, receipt photos included, to one file, and restore it later
- Works offline. Data is saved **only on your iPhone** and is never uploaded

## Install on your iPhone

The files need to be hosted on an `https://` address once. GitHub Pages is free:

1. On github.com, create a new **public** repository, e.g. `expenses`.
2. Click **uploading an existing file** and drag in everything in this folder
   (`index.html`, `app.js`, `styles.css`, `zip.js`, `xlsx.js`, `sw.js`, `manifest.webmanifest`, `icons/`). Commit.
3. Go to **Settings → Pages**. Under **Build and deployment**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then click **Save**.
   About a minute later the app is live at `https://<your-username>.github.io/expenses/`.
4. On the iPhone, open that address in **Safari**. Tap **Share → Add to Home Screen → Add**.
5. Always open the app from the **Home Screen icon**. The icon keeps its own storage, separate from Safari tabs.

The repository only holds the app's code. Spreadsheets (`.xlsx`) and backups (`.zip`) in this folder are
excluded by `.gitignore`, so they are never uploaded. Your expenses never leave the phone, so anyone who opens
the address just sees an empty app.

## Keep your data safe

Your expenses live only in the app on your iPhone. Deleting the Home Screen icon deletes them,
and they may not carry over to a new phone. So back up once a month:

1. Tap the **share icon** (top right) → **Save backup file** → **Save to Files** → choose iCloud Drive.
2. The menu shows when you last saved a backup.

The backup is one `.zip` file. It holds all your expenses plus a `receipts` folder with every receipt photo,
which you can also open directly in the Files app.

**To restore** (e.g. on a new phone): install the app, tap the share icon → **Restore from backup file**,
and pick the `.zip`. Restoring only adds expenses that are missing. It never changes or deletes what's
already in the app, so it's safe to restore the same backup twice.

The Excel export is for reading and sharing your spending. The app can't import it back, so use the backup file for safekeeping.

## Updating the app

Upload the changed files to the same repository. The app checks for the newest version each time you
open it while online. GitHub may take a few minutes to serve the new files.

## Files

| File | What it does |
|------|--------------|
| `index.html` | Page layout |
| `styles.css` | Look and feel (light and dark mode) |
| `app.js` | App logic and on-device storage (IndexedDB) |
| `xlsx.js` | Small built-in Excel writer, no internet needed |
| `zip.js` | Zip packaging for Excel files and backups |
| `sw.js` | Offline support |
| `manifest.webmanifest`, `icons/` | Home Screen name and icon |
