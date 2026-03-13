require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { Client: SelfBotClient } = require('discord.js-selfbot-v13');
const { Client: BotPrincipalClient, GatewayIntentBits } = require('discord.js');
const QRCode = require('qrcode');
const { AttachmentBuilder } = require('discord.js-selfbot-v13');

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

// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (ROBUSTA) =====
// ===== FUNÇÃO PARA GERAR PAYLOAD PIX (PADRÃO OFICIAL) =====
function gerarPayloadPix(chave, valor = null, descricao = '', nomeRecebedor = 'DiscordBot', cidade = 'BRASILIA') {
    try {
        // Validação da chave
        if (!chave) throw new Error('Chave Pix não fornecida');
        
        // Determinar tipo de chave e limpar
        let chaveLimpa = chave.trim();
        let tipoChave = '01'; // Padrão: telefone/CPF/CNPJ (só números)
        
        if (chaveLimpa.includes('@')) {
            tipoChave = '02'; // e-mail
        } else if (chaveLimpa.length === 36 && chaveLimpa.includes('-')) {
            tipoChave = '01'; // chave aleatória (trata como texto)
        } else {
            // Remove tudo que não for número
            chaveLimpa = chaveLimpa.replace(/\D/g, '');
        }
        
        // Limitar tamanho da chave (máximo 30 caracteres)
        if (chaveLimpa.length > 30) chaveLimpa = chaveLimpa.substring(0, 30);
        
        // Construir payload passo a passo
        let payload = '';
        
        // 1. Payload Format Indicator (ID 00)
        payload += '000201'; // Versão 01
        
        // 2. Merchant Account Information (ID 26)
        payload += '26'; // ID do campo
        // Subcampos do GUI (ID 00) e chave (ID 01)
        let gui = '0014br.gov.bcb.pix';
        let chaveCampo = tipoChave + chaveLimpa.length.toString().padStart(2, '0') + chaveLimpa;
        let merchantAccountInfo = gui + chaveCampo;
        let tamanhoMAI = merchantAccountInfo.length.toString().padStart(2, '0');
        payload += tamanhoMAI + merchantAccountInfo;
        
        // 3. Merchant Category Code (ID 52)
        payload += '52040000'; // Código padrão
        
        // 4. Transaction Currency (ID 53)
        payload += '5303986'; // 986 = BRL
        
        // 5. Country Code (ID 58)
        payload += '5802BR';
        
        // 6. Merchant Name (ID 59)
        let nome = nomeRecebedor.substring(0, 25);
        payload += '59' + nome.length.toString().padStart(2, '0') + nome;
        
        // 7. Merchant City (ID 60)
        let cid = cidade.substring(0, 15);
        payload += '60' + cid.length.toString().padStart(2, '0') + cid;
        
        // 8. Valor (ID 54) - opcional
        if (valor) {
            let valorNum = parseFloat(valor.replace(',', '.')).toFixed(2);
            let valorStr = valorNum.replace('.', '');
            payload += '54' + valorStr.length.toString().padStart(2, '0') + valorNum;
        }
        
        // 9. Additional Data Field (ID 62) - opcional (descrição)
        if (descricao && descricao !== 'Pagamento via Pix') {
            let descLimpa = descricao.substring(0, 20);
            let txId = '***'; // Identificador da transação (opcional)
            let campoAdicional = '05' + descLimpa.length.toString().padStart(2, '0') + descLimpa;
            payload += '62' + (campoAdicional.length + 2).toString().padStart(2, '0') + campoAdicional;
        }
        
        // 10. CRC16 (ID 63) - deve ser calculado
        // O CRC16 é calculado sobre todo o payload até antes do campo 63
        let payloadSemCRC = payload;
        let crc16 = calcularCRC16(payloadSemCRC + '6304');
        payload += '6304' + crc16;
        
        console.log(`   ✅ Payload gerado (${payload.length} caracteres)`);
        return payload;
        
    } catch (error) {
        console.error('❌ Erro ao gerar payload:', error);
        // Retorna um payload de fallback (chave fixa)
        return '0002010014br.gov.bcb.pix01111234567895204000053039865802BR5913DiscordBot6008BRASILIA6304A1B2';
    }
}

// ===== FUNÇÃO PARA CALCULAR CRC16 (IMPLEMENTAÇÃO PADRÃO) =====
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

// ===== FUNÇÃO PARA INICIAR SELF-BOT =====
async function iniciarSelfBot(usuario) {
    
    // Cache para evitar processar mensagens duplicadas (limpa a cada 10 minutos)
const mensagensProcessadas = new Set();
setInterval(() => mensagensProcessadas.clear(), 10 * 60 * 1000);
    
    try {
        console.log(`🔄 [${new Date().toISOString()}] Iniciando self-bot para ${usuario.discordTag || usuario.userId}...`);

        const client = new SelfBotClient({
            checkUpdate: false,
            intents: 32767 // Todas as intents
        });

        client.on('ready', () => {
            console.log(`✅✅✅ [${new Date().toISOString()}] SELF-BOT ONLINE: ${client.user.tag}`);
            usuario.status = 'online';
            usuario.discordTag = client.user.tag;
            salvarUsuarios();

            selfBotsAtivos.set(usuario.userId, {
                client,
                tag: client.user.tag
            });
        });

        // Cache para evitar duplicação
const mensagensProcessadas = new Set();
setInterval(() => mensagensProcessadas.clear(), 10 * 60 * 1000);

client.on('messageCreate', async (message) => {
    try {
        // Log bruto
        console.log(`\n📨 [${new Date().toISOString()}] [SELF-BOT ${client.user.tag}] Mensagem recebida:`);
        console.log(`   Autor: ${message.author.tag} (${message.author.id})`);
        console.log(`   Conteúdo: "${message.content}"`);
        console.log(`   Canal: ${message.channel.type}`);

        // Verificar duplicação
        if (mensagensProcessadas.has(message.id)) {
            console.log(`   ⏭️ Ignorando: mensagem já processada (ID: ${message.id})`);
            return;
        }
        mensagensProcessadas.add(message.id);

        // Ignorar mensagens sem prefixo
        if (!message.content.startsWith(PREFIX)) {
            console.log(`   ⏭️ Ignorando: não começa com ${PREFIX}`);
            return;
        }

        // Verificar autor (dono ou admin)
        if (message.author.id !== usuario.userId && message.author.id !== ADMIN_ID) {
            console.log(`   ⏭️ Ignorando: não é o dono nem o admin`);
            return;
        }

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const command = args.shift().toLowerCase();

        console.log(`   🎯 Comando: ${command}`);

        // Comando !teste
        if (command === 'teste') {
            await message.reply('✅ **Self-bot funcionando perfeitamente!**');
            console.log(`   ✅ Teste respondido`);
        }

        // Comando !ping
        if (command === 'ping') {
            await message.reply('🏓 **Pong!**');
        }

        // Comando !help
        if (command === 'help' || command === 'ajuda') {
            await message.reply(
                '📋 **COMANDOS DISPONÍVEIS:**\n\n' +
                '`!ping` - Testar conexão\n' +
                '`!teste` - Testar funcionamento\n' +
                '`!pix [chave]` - Gerar QR Code Pix\n' +
                '`!pix [chave] [descrição]` - Pix com descrição\n' +
                '`!pix [valor] [chave] [descrição]` - Pix com valor\n' +
                '`!help` - Mostrar esta ajuda'
            );
        }

        // Comando !pix
        if (command === 'pix') {
            console.log(`   🎯 Executando PIX`);

            if (args.length === 0) {
                await message.reply(
                    '❌ **Como usar o Pix:**\n' +
                    '`!pix [chave]` - Ex: `!pix 11999999999`\n' +
                    '`!pix [chave] [descrição]` - Ex: `!pix 11999999999 Pizza`\n' +
                    '`!pix [valor] [chave] [descrição]` - Ex: `!pix 50.00 11999999999 Jantar`'
                );
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

            console.log(`   🔑 Chave: ${chavePix}`);
            if (valor) console.log(`   💰 Valor: ${valor}`);
            if (descricao) console.log(`   📝 Descrição: ${descricao}`);

            const procMsg = await message.reply('🔄 **Gerando QR Code Pix...**');

            try {
                const payload = gerarPayloadPix(chavePix, valor, descricao);
                console.log(`   ✅ Payload gerado, gerando QR Code...`);

                const qrBuffer = await QRCode.toBuffer(payload, {
                    type: 'png',
                    width: 400,
                    margin: 2,
                    errorCorrectionLevel: 'M'
                });

                console.log(`   ✅ QR Code gerado (${qrBuffer.length} bytes)`);

                const attachment = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });

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

                console.log(`   ✅ QR Code enviado com sucesso`);

                usuario.comandosUsados = (usuario.comandosUsados || 0) + 1;
                salvarUsuarios();

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

// ===== INICIAR TODOS OS SELF-BOTS =====
function iniciarTodosSelfBots() {
    console.log(`🔄 Iniciando ${usuarios.length} self-bots do banco de dados...`);
    for (const usuario of usuarios) {
        if (usuario.status === 'active') {
            setTimeout(() => iniciarSelfBot(usuario), 2000);
        }
    }
}

// ===== BOT PRINCIPAL =====
const botPrincipal = new BotPrincipalClient({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

botPrincipal.once('ready', () => {
    console.log(`✅ Bot Principal online: ${botPrincipal.user.tag}`);
    console.log(`👑 Admin ID: ${ADMIN_ID}`);
    iniciarTodosSelfBots();
});

botPrincipal.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (!message.content.startsWith(PREFIX)) return;

    const args = message.content.slice(PREFIX.length).trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const isAdmin = message.author.id === ADMIN_ID;

    // Comando público
    if (command === 'ping') {
        return message.reply('🏓 Pong!');
    }

    // Comandos de admin
    if (!isAdmin) return;

    if (command === 'status') {
        return message.reply(
            `📊 **STATUS**\n\n` +
            `👥 Usuários: ${usuarios.length}\n` +
            `🟢 Online: ${selfBotsAtivos.size}\n` +
            `🔴 Offline: ${usuarios.length - selfBotsAtivos.size}`
        );
    }

    if (command === 'listar') {
        if (usuarios.length === 0) {
            return message.reply('📭 Nenhum usuário.');
        }

        let lista = '📋 **USUÁRIOS**\n\n';
        for (const u of usuarios) {
            const online = selfBotsAtivos.has(u.userId) ? '🟢' : '🔴';
            lista += `${online} **${u.discordTag || u.userId}**\n`;
        }
        return message.reply(lista);
    }

    if (command === 'registrar') {
        if (args.length < 2) {
            return message.reply('❌ Use: `!registrar [ID] [token]`');
        }

        const userId = args[0];
        const userToken = args[1];

        const msgProc = await message.reply('🔄 Processando...');

        try {
            if (usuarios.some(u => u.userId === userId)) {
                return msgProc.edit('❌ Usuário já registrado!');
            }

            const testClient = new SelfBotClient({ checkUpdate: false });
            let userTag;
            try {
                await testClient.login(userToken);
                userTag = testClient.user.tag;
                await testClient.destroy();
            } catch (err) {
                return msgProc.edit('❌ Token inválido!');
            }

            const novoUsuario = {
                userId,
                discordTag: userTag,
                userToken,
                status: 'active',
                registradoEm: new Date().toISOString(),
                comandosUsados: 0
            };

            usuarios.push(novoUsuario);
            salvarUsuarios();

            const iniciou = await iniciarSelfBot(novoUsuario);

            await msgProc.edit(
                `✅ **USUÁRIO REGISTRADO!**\n\n` +
                `• Usuário: **${userTag}**\n` +
                `• Self-bot: ${iniciou ? '🟢 Online' : '🟡 Iniciando...'}\n\n` +
                `📱 O usuário agora pode usar os comandos em QUALQUER lugar!`
            );
        } catch (error) {
            console.error('Erro no registro:', error);
            await msgProc.edit(`❌ Erro: ${error.message}`);
        }
    }

    if (command === 'remover') {
        if (args.length < 1) {
            return message.reply('❌ Use: `!remover [ID]`');
        }

        const userId = args[0];
        const index = usuarios.findIndex(u => u.userId === userId);

        if (index === -1) {
            return message.reply('❌ Usuário não encontrado!');
        }

        const userTag = usuarios[index].discordTag;

        if (selfBotsAtivos.has(userId)) {
            try {
                await selfBotsAtivos.get(userId).client.destroy();
                selfBotsAtivos.delete(userId);
            } catch (err) {}
        }

        usuarios.splice(index, 1);
        salvarUsuarios();

        await message.reply(`✅ Usuário **${userTag}** removido!`);
    }
});

// ===== INICIAR BOT PRINCIPAL =====
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

// ===== TRATAMENTO DE ERROS NÃO CAPTURADOS =====
process.on('uncaughtException', (err) => {
    console.error('❌ Exceção não capturada:', err);
});

process.on('unhandledRejection', (err) => {
    console.error('❌ Promise rejeitada:', err);
});