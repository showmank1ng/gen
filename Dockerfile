# Usar Node.js versão 18
FROM node:18-slim

# Criar diretório de trabalho
WORKDIR /app

# Copiar arquivos de dependências primeiro (aproveita cache)
COPY package*.json ./

# Instalar todas as dependências (COM FORÇA TOTAL)
RUN npm install -g npm@latest && \
    npm install --no-audit --no-fund && \
    npm install discord.js-selfbot-v13@latest --save --no-audit --no-fund

# Verificar se a biblioteca problemática foi instalada
RUN node -e "try { require('discord.js-selfbot-v13'); console.log('✅ Selfbot instalado!'); } catch(e) { console.error('❌ Falha:', e); process.exit(1); }"

# Copiar o resto do código
COPY . .

# Criar pasta database com permissões
RUN mkdir -p /tmp/database && chmod 777 /tmp/database

# Expor a porta que o Render vai usar
EXPOSE 3000

# Comando para iniciar o bot
CMD ["node", "index.js"]