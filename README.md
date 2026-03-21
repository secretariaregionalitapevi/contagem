# Contagem – V4 (PWA Premium)

PWA moderno para contagem de participantes com sincronização offline e integração com Google Sheets.

## ✨ Destaques
- **Design Premium**: Interface moderna inspirada no App Mocidade.
- **Sincronização Offline**: Envio imediato ou fila offline com auto-sync (15s).
- **Service Worker**: PWA completo com cache e atualizações em tempo real.
- **Google Sheets**: Integração total para resumo e estatísticas.

## 🚀 Como Deployar no Vercel

O projeto está configurado para o Vercel através do arquivo `vercel.json`.

1. **Subir para o GitHub**:
   ```bash
   git add .
   git commit -m "Upgrade UI and Vercel config"
   git push origin main
   ```
2. **Conectar ao Vercel**:
   - Acesse [Vercel](https://vercel.com).
   - Importe o repositório do projeto.
   - O Vercel detectará as configurações e fará o deploy automaticamente.

## 📊 Planilha e Backend

### Aba "Dados"
Colunas: `Timestamp | Cargo | Ministério | Administração`

### Apps Script (`code.gs`)
- O arquivo `code.gs` contém toda a lógica necessária para o backend no Google Sheets.
- Certifique-se de implantar como **Web App** e atualizar a URL no seu `app.js`.

## 🛠️ Desenvolvimento Local
```bash
npm install
npm run dev
```
Acesse `http://localhost:3000` para testar.
