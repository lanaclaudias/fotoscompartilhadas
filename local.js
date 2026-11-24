// Roda o site no computador (na Vercel, o app.js é usado diretamente e a pasta public/ é servida pela CDN)
const path = require('path');
const express = require('express');
const app = require('./app');

const PORT = Number(process.env.PORT || 3000);
const site = express();
site.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
site.use(app);

site.listen(PORT, () => {
  console.log(`\n💍 Site rodando em http://localhost:${PORT}`);
  console.log(`   Painel: http://localhost:${PORT}/painel`);
  console.log('   (o QR Code no painel já usa o IP do Wi-Fi para abrir no celular)\n');
});
