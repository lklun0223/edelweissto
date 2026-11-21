# Vendored assets

All vendored runtime assets load from the same origin as Workie. Refresh this record and bump the shell version whenever assets change.

| Asset | Upstream | License |
| --- | --- | --- |
| Cormorant Garamond variable font | https://github.com/google/fonts/tree/main/ofl/cormorantgaramond | SIL OFL 1.1; cormorant-OFL.txt |
| Inter Variable 4.1 | https://github.com/rsms/inter/tree/v4.1 | SIL OFL 1.1; inter-OFL.txt |
| Tailwind browser bundle 3.4.17 | https://cdn.tailwindcss.com/3.4.17 | MIT; tailwind-LICENSE.txt |
| Chart.js 4.4.9 UMD | https://github.com/chartjs/Chart.js/tree/v4.4.9 | MIT; chart-LICENSE.txt |
| Lucide 1.8.0 UMD | https://github.com/lucide-icons/lucide | ISC and bundled attribution; lucide-LICENSE.txt |

Tailwind browser compilation is inherited from v10 and now bundled locally. Replace it with generated stylesheet output after the HTML class inventory settles. Firebase is an explicit optional legacy integration and is outside the offline shell.
