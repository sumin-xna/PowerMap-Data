# TDMS UV Output Comparator

A static GitHub Pages web app for comparing PowerMAP / TDMS UV output files.

## What it extracts

For each dropped `.tdms` file, the app extracts:

- File name
- TDMS name
- Serial number
- Calibration date
- Date of measurement
- Notes
- Model / unit type / range
- UV sample rate
- UVA / UVB / UVC / UVV energy density in `mJ/cm^2`
- UVA / UVB / UVC / UVV peak irradiance in `mW/cm^2`

It shows the results in one comparison table and downloads a single Excel workbook.

## Privacy

Files are processed locally in the browser. The app does not upload TDMS files to a server.

## How to run locally

Just open `index.html` in a modern browser, or serve the folder locally:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

## How to host on GitHub Pages

1. Create a new GitHub repository, for example `tdms-uv-comparator`.
2. Upload `index.html`, `app.js`, `styles.css`, `.nojekyll`, and this `README.md` to the root of the repository.
3. In GitHub, go to **Settings → Pages**.
4. Under **Build and deployment**, choose **Deploy from a branch**.
5. Choose branch `main` and folder `/root`, then click **Save**.
6. GitHub will show the public Pages URL after deployment.

## Notes

The app is optimized for TDMS files where UV channels store `Energy Density` and `Peak Irradiance` as TDMS channel properties. It was written for PowerMAP-style files with channels like `UVA`, `UVB`, `UVC`, and `UVV`.

Excel generation uses the SheetJS browser script from the official SheetJS CDN.
