require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
const { Client: BotPrincipalClient, GatewayIntentBits } = require('discord.js');
const QRCode = require('qrcode');
const { MessageAttachment } = require('discord.js-selfbot-v13');

// ===== CONFIGURAÇÕES =====
const PREFIX = process.env.PREFIX || '!';
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;

// ===== SERVIDOR WEB =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Pix Multi-Bot Online!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// ===== BANCO DE DADOS =====
const dbPath = path.join('/tmp', 'users.json');

let usuarios = [];
try {
    if (fs.existsSync(dbPath)) {
        usuarios = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        console.log(`📂 Banco carregado: ${usuarios.length} usuários`);
    } else {
        fs.writeFileSync(dbPath, JSON.stringify([]));
        console.log('📂 Novo banco criado');
    }
} catch (error) {
    console.error('❌ Erro ao ler banco:', error);
    usuarios = [];
}

function salvarUsuarios() {
    try {
        fs.writeFileSync(dbPath, JSON.stringify(usuarios, null, 2));
    } catch (error) {
        console.error('❌ Erro ao salvar banco:', error);
    }
}

// ===== SELF-BOTS ATIVOS =====
const selfBotsAtivos = new Map();

// ===== FUNÇÃO PARA GERAR PAYLOAD USANDO API CONFIÁVEL =====
async function gerarPayloadPix(chave, valor = null, descricao = '') {
    console.log(`   [API] Solicitando Pix para chave: ${chave}, valor: ${valor}, descrição: ${descricao}`);

    try {
        // Construir URL da API
        let url = `https://gerarqrcodepix.com.br/api/v1?nome=PIX%20MULTI%20BOT&cidade=BRASILIA&chave=${encodeURIComponent(chave)}&saida=br`;

        // Adicionar valor se fornecido
        if (valor) {
            const valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            url += `&valor=${valorNum}`;
        }

        // Adicionar txid (descrição) se fornecida
        if (descricao && descricao !== 'Pagamento via Pix') {
            const txid = descricao.replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
            if (txid.length > 0) {
                url += `&txid=${encodeURIComponent(txid)}`;
            }
        }

        console.log(`   📡 URL da API: ${url}`);

        // Fazer requisição à API
        const response = await fetch(url);
        
        if (!response.ok) {
            throw new Error(`API retornou erro ${response.status}`);
        }

        // A API retorna um JSON com o campo "brcode"
        const data = await response.json();
        const brCode = data.brcode; // Extrai o BR Code do JSON
        
        if (!brCode) {
            throw new Error('Resposta da API não contém brcode');
        }

        console.log(`   ✅ BR Code recebido: ${brCode.substring(0, 50)}...`);
        return brCode;

    } catch (error) {
        console.error('❌ Erro na API:', error.message);
        // Retorna um código de fallback
        return '00020126360014BR.GOV.BCB.PIX0114111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
    }
}

// ===== FUNÇÃO PARA GERAR PAYLOAD DE TESTE (EXEMPLO DO BANCO CENTRAL) =====
function gerarPayloadTeste() {
    // Este payload é um exemplo que deve funcionar em qualquer banco
    return '00020126360014BR.GOV.BCB.PIX0114111111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304EB32';
}

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 [${new Date().toISOString()}] Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({ checkUpdate: false, intents: 32767 });

        const mensagensProcessadas = new Set();
        setInterval(() => mensagensProcessadas.clear(), 10 * 60 * 1000);

        client.on('ready', () => {
            console.log(`✅✅✅ [${new Date().toISOString()}] SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();
            selfBotsAtivos.set(usuario.userId, { client, tag: client.user.tag });
        });

        client.on('messageCreate', async (message) => {
            try {
                console.log(`\n📨 [${new Date().toISOString()}] [SELF-BOT ${client.user.tag}] Mensagem: "${message.content}" de ${message.author.tag}`);

                if (mensagensProcessadas.has(message.id)) return;
                mensagensProcessadas.add(message.id);

                if (!message.content.startsWith(PREFIX)) return;
                if (message.author.id !== usuario.userId && message.author.id !== ADMIN_ID) return;

                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando!**');
                } else if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                } else if (command === 'help' || command === 'ajuda') {
                    await message.reply(
                        '📋 **COMANDOS DISPONÍVEIS:**\n\n' +
                        '`!ping` - Testar conexão\n' +
                        '`!teste` - Testar funcionamento\n' +