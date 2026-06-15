# TDMS UV Output Comparator

Static GitHub Pages web app for comparing PowerMAP `.tdms` UV output files.

## What it extracts

For each dropped TDMS file, the app extracts:

- File name
- TDMS run/name
- Serial number
- Calibration date
- Date of measurement
- Notes
- Model / unit type / range
- UV sample rate
- UVA / UVB / UVC / UVV energy density in **J/cm^2**
- UVA / UVB / UVC / UVV peak irradiance in **W/cm^2**

## Test vs control comparison

After uploading files, use the **Role** dropdown in the comparison table to mark rows as:

- `Control`
- `Test`
- `Unassigned`

Multiple rows can be marked as Control. The app averages the selected controls for each UV metric and calculates:

```text
(test value - control average) / control average * 100
```

The percent differences are shown in the browser and included in the Excel workbook.

## Excel workbook

The **Download Excel** button creates a workbook with these sheets:

1. `TDMS Comparison` — one row per file, with metadata and UV outputs.
2. `Channel Details` — one row per UV channel per file.
3. `Control Averages` — average/min/max for the selected controls.
4. `Test vs Control % Diff` — test values, control averages, and percent differences.

## Hosting on GitHub Pages

1. Create a GitHub repository.
2. Upload these files to the repository root:
   - `index.html`
   - `app.js`
   - `styles.css`
   - `.nojekyll`
   - `README.md`
3. Go to **Settings → Pages**.
4. Set the source to deploy from the `main` branch and `/root` folder.
5. Open the GitHub Pages URL after deployment finishes.

## Privacy

All parsing happens locally in the browser. TDMS files are not uploaded to a server.

## Dependency

The app uses the SheetJS browser bundle from CDN only for Excel workbook creation. TDMS parsing is implemented in `app.js`.
