require('dotenv').config();
const express = require('express');

// ===== SERVIDOR WEB (para Render) =====
const app = express();
const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('✅ Bot em teste!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 Servidor rodando na porta ${PORT}`);
});

// ===== CONFIGURAÇÕES =====
const PREFIX = '!';
const MAIN_BOT_TOKEN = process.env.MAIN_BOT_TOKEN;

// ===== SELF-BOT SIMPLES =====
async function startSelfBot() {
    try {
        console.log('🔄 Iniciando self-bot de teste...');
        
        const { Client } = require('discord.js-selfbot-v13');
        const client = new Client({ 
            checkUpdate: false,
            intents: [] // Self-bot não precisa de intents declaradas
        });

        client.on('ready', () => {
            console.log(`✅ SELF-BOT ONLINE: ${client.user.tag}`);
            console.log(`👤 ID: ${client.user.id}`);
        });

        // Capturar TODAS as mensagens
        client.on('messageCreate', (message) => {
            console.log(`📨 Mensagem recebida:`);
            console.log(`  De: ${message.author.tag}`);
            console.log(`  Conteúdo: "${message.content}"`);
            console.log(`  Canal: ${message.channel.type}`);
            
            // Responder a QUALQUER mensagem que comece com !
            if (message.content.startsWith('!')) {
                console.log('  ✅ Comando detectado!');
                
                // Tentar responder
                message.reply('✅ Self-bot recebeu o comando!')
                    .then(() => console.log('  ✅ Resposta enviada'))
                    .catch(err => console.error('  ❌ Erro ao responder:', err.message));
            }
        });

        // Token de teste (você vai substituir pelo token da sua conta)
        const USER_TOKEN = 'ODIxNTg4NDU2MjQ5NjIyNTM5.G6Hq5d.tOt4dWtI58AA46yAcW8If8goWPGrJ17RZPKdr4'; // COLE SEU TOKEN AQUI PARA TESTE
        
        await client.login(USER_TOKEN);
        
    } catch (err) {
        console.error('❌ Erro no self-bot:', err);
    }
}

// Iniciar self-bot automaticamente
setTimeout(() => {
    startSelfBot();
}, 2000);

// ===== BOT PRINCIPAL (opcional, só para manter o servidor) =====
console.log('✅ Sistema de teste iniciado');