require('dotenv').config();
const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');
const fs = require('fs-extra');
const path = require('path');

// ===== CONFIGURAÇÃO DO SERVIDOR WEB =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send(`
        <html>
            <head><title>Pix Multi Bot</title></head>
            <body>
                <h1>✅ Bot está online!</h1>
                <p>Servidor rodando na porta ${PORT}</p>
                <p><small>Render uptime: ${process.uptime().toFixed(0)}s</small></p>
            </body>
        </html>
    `);
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Web server: http://0.0.0.0:${PORT}`);
});

// ===== CONFIGURAÇÃO DO BOT PRINCIPAL =====
const mainClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// ===== VERIFICAÇÃO DE TOKEN =====
const token = process.env.MAIN_BOT_TOKEN;
if (!token) {
    console.error('❌ ERRO: MAIN_BOT_TOKEN não configurado!');
    console.error('Adicione nas Environment Variables do Render');
    process.exit(1);
}

// ===== EVENTOS DO BOT =====
mainClient.once('ready', () => {
    console.log(`✅ Bot principal: ${mainClient.user.tag}`);
    console.log(`📊 Prefixo: ${process.env.PREFIX || '!'}`);
});

mainClient.on('messageCreate', async message => {
    if (message.author.bot) return;
    
    const prefix = process.env.PREFIX || '!';
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();

    // Comando de teste
    if (command === 'ping') {
        await message.reply('🏓 Pong!');
    }
    
    // Comando de ajuda
    if (command === 'ajuda' || command === 'help') {
        await message.reply(
            '**Comandos disponíveis:**\n' +
            '`!ping` - Testar se o bot responde\n' +
            '`!status` - Ver status do bot'
        );
    }
    
    // Comando de status
    if (command === 'status') {
        await message.reply(
            `📊 **Status do Bot**\n` +
            `• Online: ✅\n` +
            `• Uptime: ${Math.floor(process.uptime() / 60)} minutos\n` +
            `• Servidor: Render 🚀`
        );
    }
});

// ===== LOGIN =====
mainClient.login(token)
    .then(() => console.log('🔑 Login realizado com sucesso!'))
    .catch(err => {
        console.error('❌ Erro no login:', err.message);
        console.error('Verifique se o token está correto');
        process.exit(1);
    });

// ===== KEEP ALIVE =====
setInterval(() => {
    console.log('💓 Heartbeat: Bot ativo, memória:', 
        Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB');
}, 10 * 60 * 1000); // A cada 10 minutos

// ===== TRATAMENTO DE ERROS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});