# Restaurant Atlas

A dependency-free personal restaurant log and ranking site, ready for GitHub Pages. It stores changes in your browser and lets you export a versioned JSON backup.

## Publish with GitHub Pages

1. Create a new GitHub repository and upload this entire folder, preserving the `assets` and `data` folders.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select your main branch and the `/ (root)` folder, then save.
5. GitHub will show the public URL when deployment finishes.

The empty `.nojekyll` file tells GitHub Pages to serve the project exactly as it is.

## Run locally

From this folder, run:

```bash
python3 -m http.server
```

Then open `http://localhost:8000`. Opening `index.html` directly also works; the embedded seed copy is used when the browser blocks the JSON request on `file://`.

## How scoring works

| Category | What it captures | Weight |
| --- | --- | ---: |
| Food | Taste, execution and memorability | 2× |
| Ambiance | The room, noise, service and how it felt to sit there | 1× |
| Value | Value for money: higher is always better | 1× |

The weighted score is `(food × 2 + ambiance + value) ÷ 4`. A gut score, when present, overrides that result for the overall ranking. It does not alter the three category scores.

To rebalance the categories, edit the `WEIGHTS` constant at the top of `assets/app.js`. The formula automatically divides by the sum of the weights.

## Back up your atlas

Browser storage is device-local. After adding or editing places, use **Export** to download `restaurants.json`, replace `data/restaurants.json` with it, and commit that change to GitHub. This gives you a readable, versioned backup. **Import** safely merges a backup by ID, or by case-insensitive restaurant name when no ID matches; it never wipes the collection.

## Other metrics you could add

- Split service out from ambiance as its own score.
- Add occasion tags such as date night, quick lunch or big group.
- Track booking difficulty.
- Add a repeat-visit counter to distinguish favourites from one-off discoveries.
