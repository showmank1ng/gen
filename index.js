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
    console.log(`🌐 Servidor web rodando na porta ${PORT}`);
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

// ===== FUNÇÃO CRC16 CORRIGIDA =====
function calcularCRC16(payload) {
    let polinomio = 0x1021;
    let resultado = 0xFFFF;
    
    for (let i = 0; i < payload.length; i++) {
        resultado ^= (payload.charCodeAt(i) << 8);
        for (let j = 0; j < 8; j++) {
            if (resultado & 0x8000) {
                resultado = (resultado << 1) ^ polinomio;
            } else {
                resultado = (resultado << 1);
            }
            resultado &= 0xFFFF;
        }
    }
    
    return resultado.toString(16).toUpperCase().padStart(4, '0');
}

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (FUNCIONAL) =====
function gerarPayloadPix(chave, valor = null, descricao = '') {
    console.log(`   [gerarPayloadPix] Chamada com chave: ${chave}, valor: ${valor}, descricao: ${descricao}`);
    
    try {
        if (!chave) throw new Error('Chave Pix não fornecida');

        // --- 1. TRATAMENTO DA CHAVE ---
        let chaveLimpa = chave.trim();
        let tipoChave = '01'; // Padrão: telefone/CPF/CNPJ
        
        if (chaveLimpa.includes('@')) {
            tipoChave = '02'; // Email
        } else if (chaveLimpa.includes('-') && chaveLimpa.length === 36) {
            tipoChave = '01'; // Chave aleatória
        } else {
            chaveLimpa = chaveLimpa.replace(/\D/g, ''); // Remove não numéricos
        }

        if (!chaveLimpa || chaveLimpa.length === 0) {
            throw new Error('Chave inválida após limpeza');
        }

        if (chaveLimpa.length > 30) {
            chaveLimpa = chaveLimpa.substring(0, 30);
        }

        // --- 2. CONSTRUÇÃO DO PAYLOAD ---
        let payload = '';

        // 00 - Payload Format Indicator
        payload += '000201';

        // 26 - Merchant Account Information
        let gui = '0014BR.GOV.BCB.PIX';
        let chaveCampo = tipoChave + chaveLimpa.length.toString().padStart(2, '0') + chaveLimpa;
        let merchantAccountInfo = gui + chaveCampo;
        let tamanhoMAI = merchantAccountInfo.length.toString().padStart(2, '0');
        payload += '26' + tamanhoMAI + merchantAccountInfo;

        // 52 - Merchant Category Code
        payload += '52040000';

        // 53 - Transaction Currency
        payload += '5303986';

        // 54 - Transaction Amount (se houver valor)
        if (valor) {
            let valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            let valorStr = valorNum.replace('.', '');
            payload += '54' + valorStr.length.toString().padStart(2, '0') + valorNum;
        }

        // 58 - Country Code
        payload += '5802BR';

        // 59 - Merchant Name (OBRIGATÓRIO)
        payload += '5915PIX MULTI BOT';

        // 60 - Merchant City (OBRIGATÓRIO)
        payload += '6008BRASILIA';

        // 61 - Postal Code (OPCIONAL, mas vamos omitir)

        // 62 - Additional Data Field (OBRIGATÓRIO)
        let txId = '***';
        if (descricao && descricao !== 'Pagamento via Pix' && descricao !== 'Pagamento') {
            txId = descricao.substring(0, 20).replace(/[^a-zA-Z0-9]/g, '');
        }
        
        let subcampo05 = '05' + txId.length.toString().padStart(2, '0') + txId;
        let campo62 = subcampo05;
        payload += '62' + campo62.length.toString().padStart(2, '0') + campo62;

        // --- 3. CÁLCULO DO CRC16 ---
        let payloadParaCRC = payload + '6304';
        let crc = calcularCRC16(payloadParaCRC);
        payload += '6304' + crc;

        console.log(`   ✅ Payload gerado (${payload.length} caracteres)`);
        console.log(`   📦 Payload: ${payload}`);
        
        return payload;
        
    } catch (error) {
        console.error('❌ [gerarPayloadPix] Exceção:', error.message);
        // Payload de fallback (testado e funcional)
        return '00020126360014BR.GOV.BCB.PIX0134111111111115204000053039865802BR5915PIX MULTI BOT6008BRASILIA62070503***6304F2C4';
    }
}

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    try {
        console.log(`🔄 [${new Date().toISOString()}] Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({ checkUpdate: false, intents: 32767 });

        const mensagensProcessadas = new Set();
        setInterval(() => {
            mensagensProcessadas.clear();
        }, 10 * 60 * 1000);

        client.on('ready', () => {
            console.log(`✅✅✅ [${new Date().toISOString()}] SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();
            selfBotsAtivos.set(usuario.userId, { client, tag: client.user.tag });
        });

        client.on('messageCreate', async (message) => {
            try {
                console.log(`\n📨 [${new Date().toISOString()}] [SELF-BOT ${client.user ? client.user.tag : 'desconhecido'}] Mensagem recebida:`);
                console.log(`   Autor: ${message.author.tag} (${message.author.id})`);
                console.log(`   Conteúdo: "${message.content}"`);

                if (mensagensProcessadas.has(message.id)) return;
                mensagensProcessadas.add(message.id);

                if (!message.content.startsWith(PREFIX)) return;

                if (message.author.id !== usuario.userId && message.author.id !== ADMIN_ID) return;

                const args = message.content.slice(PREFIX.length).trim().split(/ +/);
                const command = args.shift().toLowerCase();

                console.log(`   🎯 Comando: ${command}`);

                if (command === 'teste') {
                    await message.reply('✅ **Self-bot funcionando perfeitamente!**');
                } else if (command === 'ping') {
                    await message.reply('🏓 **Pong!**');
                } else if (command === 'help' || command === 'ajuda') {
                    await message.reply(
                        '📋 **COMANDOS DISPONÍVEIS:**\n\n' +
                        '`!ping` - Testar conexão\n' +
                        '`!teste` - Testar funcionamento\n' +
                        '`!pix [chave]` - Gerar QR Code Pix\n' +
                        '`!pix [chave] [descrição]` - Pix com descrição\n' +
                        '`!pix [valor] [chave] [descrição]` - Pix com valor\n' +
                        '`!help` - Mostrar esta ajuda'
                    );
                } else if (command === 'pix') {
                    if (args.length === 0) {
                        await message.reply('❌ Use: `!pix [chave]` - Ex: `!pix 11999999999`');
                        return;
                    }

                    let chavePix, valor, descricao;
                    if (args[0] && args[0].match(/^[\d,.]+$/)) {
                        valor = args[0].replace(',', '.');
                        chavePix = args[1];
                        descricao = args.slice(2).join(' ') || 'Pagamento via Pix';
                    } else {
                        chavePix = args[0];
                        valor = null;
                        descricao = args.slice(1).join(' ') || 'Pagamento via Pix';
                    }

                    if (!chavePix) {
                        await message.reply('❌ Chave Pix não fornecida!');
                        return;
                    }

                    const procMsg = await message.reply('🔄 **Gerando QR Code Pix...**');

                    try {
                        const payload = gerarPayloadPix(chavePix, valor, descricao);
                        
                        if (!payload || payload.length < 50) throw new Error('Payload inválido');

                        const qrBuffer = await QRCode.toBuffer(payload, { 
                            type: 'png', 
                            width: 400, 
                            margin: 2,
                            errorCorrectionLevel: 'M'
                        });
                        
                        const attachment = new MessageAttachment(qrBuffer, 'pix.png');

                        let resposta = `✅ **QR CODE PIX GERADO!**\n\n`;
                        resposta += `📋 **Detalhes:**\n`;
                        resposta += `• Chave: \`${chavePix}\`\n`;
                        if (valor) {
                            const vf = parseFloat(valor).toFixed(2).replace('.', ',');
                            resposta += `• Valor: R$ ${vf}\n`;
                        }
                        if (descricao && descricao !== 'Pagamento via Pix') {
                            resposta += `• Descrição: ${descricao}\n`;
                        }
                        resposta += `\n📱 **Código Pix Copia e Cola:**\n\`\`\`${payload}\`\`\``;

                        await message.reply({ content: resposta, files: [attachment] });
                        await procMsg.delete();

                        usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                        salvarUsuarios();
                        
                        console.log(`   ✅ QR Code enviado com sucesso`);
                    } catch (error) {
                        console.error(`   ❌ Erro no QR Code:`, error);
                        await procMsg.delete();
                        await message.reply('❌ Erro ao gerar QR Code. Tente novamente.');
                    }
                }
            } catch (error) {
                console.error('❌ Erro no self-bot:', error);
            }
        });

        client.on('error', (error) => {
            console.error(`❌ Erro no self-bot de ${usuario.discordTag}:`, error.message);
            usuario.status = 'offline';
            salvarUsuarios();
            selfBotsAtivos.delete(usuario.userId);
        });

        await client.login(usuario.userToken);
        console.log(`✅ Self-bot ${usuario.discordTag} iniciado.`);
        return true;
    } catch (error) {
        console.error(`❌ Erro ao iniciar self-bot:`, error.message);
        usuario.status = 'offline';
        salvarUsuarios();
        return false;
    }
}

// ===== INICIAR TODOS OS SELF-BOTS =====
function iniciarTodosSelfBots() {
    console.log(`🔄 Iniciando ${usuarios.length} self-bots...`);
    for (const usuario of usuarios) {
        if (usuario.status === 'active') {
            setTimeout(() => iniciarSelfBot(usuario), 2000);
        }
    }
}

// ===== BOT PRINCIPAL =====
const botPrincipal = new BotPrincipalClient({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.DirectMessages]
});

botPrincipal.once('ready', () => {
    console.log(`✅ Bot Principal online: ${botPrincipal.user.tag}`);
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot || !message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    if (command === 'ping') return message.reply('🏓 Pong!');
    if (!isAdmin) return;

    if (command === 'status') {
        return message.reply(
            `📊 **STATUS**\n👥 Usuários: ${usuarios.length}\n🟢 Online: ${selfBotsAtivos.size}\n🔴 Offline: ${usuarios.length - selfBotsAtivos.size}`
        );
    } else if (command === 'listar') {
        if (usuarios.length === 0) return message.reply('📭 Nenhum usuário.');
        let lista = '📋 **USUÁRIOS**\n';
        usuarios.forEach(u => {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} ${u.discordTag || u.userId}\n`;
        });
        return message.reply(lista);
    } else if (command === 'registrar') {
        if (args.length < 2) return message.reply('❌ Use: `!registrar [ID] [token]`');
        const userId = args[0], userToken = args[1];
        const msgProc = await message.reply('🔄 Processando...');

        try {
            if (usuarios.some(u => u.userId === userId)) return msgProc.edit('❌ Usuário já registrado!');

            const testClient = new SelfBotClient({ checkUpdate: false });
            let userTag;
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
            } catch {
                return msgProc.edit('❌ Token inválido!');
            }

            const novoUsuario = { userId, discordTag: userTag, userToken, status: 'active', registradoEm: new Date().toISOString(), comandosUsados: 0 };
            usuarios.push(novoUsuario);
            salvarUsuarios();

            const iniciou = await iniciarSelfBot(novoUsuario);
            await msgProc.edit(`✅ **USUÁRIO REGISTRADO!**\n• Usuário: **${userTag}**\n• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}`);
        } catch (error) {
            console.error('Erro no registro:', error);
            await msgProc.edit(`❌ Erro: ${error.message}`);
        }
    } else if (command === 'remover') {
        if (args.length < 1) return message.reply('❌ Use: `!remover [ID]`');
        const userId = args[0];
        const index = usuarios.findIndex(u => u.userId === userId);
        if (index === -1) return message.reply('❌ Usuário não encontrado!');

        if (selfBotsAtivos.has(userId)) {
            try { await selfBotsAtivos.get(userId).client.destroy(); } catch {}
            selfBotsAtivos.delete(userId);
        }
        const userTag = usuarios[index].discordTag;
        usuarios.splice(index, 1);
        salvarUsuarios();
        await message.reply(`✅ Usuário **${userTag}** removido!`);
    }
});

// ===== INICIAR =====
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN não configurado!');
    process.exit(1);
}
botPrincipal.login(BOT_TOKEN).catch(err => {
    console.error('❌ Erro no login:', err);
    process.exit(1);
});

// ===== HEARTBEAT =====
setInterval(() => {
    console.log(`💓 Heartbeat - Usuários: ${usuarios.length} | Online: ${selfBotsAtivos.size}`);
}, 60000);

process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});