# Bot.wawa — Tenka MultiBOT

Satu project berisi panel web dan backend Node.js.

## Struktur

```text
Bot.wawa/
├── package.json
├── server.js
├── public/
│   └── index.html
├── .gitignore
└── README.md
```

## Jalankan di VPS/Pterodactyl

```bash
npm install
npm start
```

Default port: `3000` (bisa diubah dengan environment variable `PORT`).

## GitHub

Upload seluruh isi folder `Bot.wawa` ke **satu repository**. GitHub Pages hanya cocok untuk file frontend statis; `server.js` harus dijalankan di VPS/Pterodactyl agar API panel bekerja.

> Pairing pada versi ini masih berupa demo. Untuk pairing WhatsApp sungguhan, backend perlu dihubungkan ke engine Multi-Bot/Baileys.
