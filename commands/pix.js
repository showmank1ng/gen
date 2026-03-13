const QRCode = require('qrcode');
const { AttachmentBuilder } = require('discord.js');

module.exports = {
    name: 'pix',
    description: 'Gera QR Code Pix',
    async execute(message, args, context) {
        try {
            // VERIFICAÇÃO 1: Tem argumentos?
            if (!args || args.length === 0) {
                return message.reply(
                    '❌ **Como usar o comando Pix:**\n' +
                    '`!pix [chave_pix]` - Apenas chave\n' +
                    '`!pix [chave_pix] [descrição]` - Com descrição\n' +
                    '`!pix [valor] [chave_pix] [descrição]` - Com valor\n\n' +
                    '**Exemplos:**\n' +
                    '• `!pix 11999999999`\n' +
                    '• `!pix email@exemplo.com Pizza`\n' +
                    '• `!pix 50.00 11999999999 Jantar`'
                );
            }

            // VERIFICAÇÃO 2: Processar argumentos
            let chavePix, valor, descricao;
            
            // Verificar se o primeiro argumento é um valor (número)
            if (args[0] && args[0].match(/^[\d,.]+$/)) {
                valor = args[0].replace(',', '.');
                chavePix = args[1];
                descricao = args.slice(2).join(' ') || 'Pagamento via Pix';
            } else {
                chavePix = args[0];
                valor = null;
                descricao = args.slice(1).join(' ') || 'Pagamento via Pix';
            }

            // VERIFICAÇÃO 3: Chave Pix existe?
            if (!chavePix) {
                return message.reply('❌ Por favor, forneça uma chave Pix válida!');
            }

            // VERIFICAÇÃO 4: Limpar chave Pix
            chavePix = chavePix.trim();
            
            // Enviar mensagem de processamento
            const processingMsg = await message.reply('🔄 Gerando QR Code Pix...');

            // GERAR PAYLOAD PIX (versão melhorada)
            const payload = gerarPayloadPix(chavePix, valor, descricao);
            
            // VALIDAÇÃO: Payload gerado?
            if (!payload || payload.length < 50) {
                await processingMsg.delete();
                return message.reply('❌ Erro ao gerar código Pix. Chave inválida?');
            }

            // GERAR QR CODE
            const qrCodeBuffer = await QRCode.toBuffer(payload, {
                type: 'png',
                width: 400,
                margin: 2,
                color: {
                    dark: '#000000',
                    light: '#ffffff'
                }
            });

            // CRIAR ATTACHMENT
            const attachment = new AttachmentBuilder(qrCodeBuffer, { 
                name: `pix-${Date.now()}.png` 
            });

            // MONTAR RESPOSTA
            let resposta = `✅ **QR Code Pix gerado com sucesso!**\n\n`;
            resposta += `📋 **Detalhes do Pix:**\n`;
            resposta += `• Chave: \`${chavePix}\`\n`;
            
            if (valor) {
                const valorFormatado = parseFloat(valor).toFixed(2);
                resposta += `• Valor: **R$ ${valorFormatado.replace('.', ',')}**\n`;
            } else {
                resposta += `• Valor: *Sem valor definido (qualquer valor)*\n`;
            }
            
            if (descricao && descricao !== 'Pagamento via Pix') {
                resposta += `• Descrição: ${descricao}\n`;
            }
            
            resposta += `\n📱 **Como usar:**\n`;
            resposta += `1️⃣ Abra o app do seu banco\n`;
            resposta += `2️⃣ Escolha "Pix" > "Pagar com QR Code"\n`;
            resposta += `3️⃣ Escaneie a imagem abaixo\n`;
            resposta += `\n🔹 **Ou use o código Pix Copia e Cola:**\n`;
            resposta += `\`\`\`${payload}\`\`\``;

            // ENVIAR RESPOSTA
            await message.reply({
                content: resposta,
                files: [attachment]
            });

            // DELETAR MENSAGEM DE PROCESSAMENTO
            await processingMsg.delete();

        } catch (error) {
            console.error('❌ ERRO NO COMANDO PIX:', error);
            await message.reply(
                '❌ **Erro ao gerar QR Code Pix**\n' +
                'Por favor, tente novamente com uma chave válida.\n' +
                'Exemplo: `!pix 11999999999`'
            );
        }
    }
};

// FUNÇÃO PARA GERAR PAYLOAD PIX (versão melhorada)
function gerarPayloadPix(chave, valor = null, descricao = '') {
    try {
        // Remover formatação da chave
        let chaveLimpa = chave.replace(/[^\w@.-]/g, '');
        
        // Identificar tipo de chave
        let tipoChave = '01'; // 01 = telefone (padrão)
        
        if (chaveLimpa.includes('@')) {
            tipoChave = '02'; // email
        } else if (chaveLimpa.length === 11 && /^\d+$/.test(chaveLimpa)) {
            tipoChave = '01'; // CPF (trata como telefone simplificado)
        } else if (chaveLimpa.length === 14 && /^\d+$/.test(chaveLimpa)) {
            tipoChave = '01'; // CNPJ
        }
        
        // Construir payload simplificado
        let payload = '000201'; // Payload Format Indicator
        
        // Merchant Account Information
        payload += '0014br.gov.bcb.pix';
        
        // Chave Pix
        const chaveLen = chaveLimpa.length.toString().padStart(2, '0');
        payload += tipoChave + chaveLen + chaveLimpa;
        
        // Merchant Category Code
        payload += '52040000';
        
        // Transaction Currency (986 = BRL)
        payload += '5303986';
        
        // Country Code
        payload += '5802BR';
        
        // Merchant Name
        payload += '5909DiscordBot';
        
        // Merchant City
        payload += '6008BRASILIA';
        
        // Adicionar valor se existir
        if (valor) {
            const valorNum = parseFloat(valor).toFixed(2);
            const valorStr = valorNum.replace('.', '');
            payload += '54' + valorStr.length.toString().padStart(2, '0') + valorNum;
        }
        
        // Additional Data Field (descrição)
        if (descricao && descricao !== 'Pagamento via Pix') {
            const descLimpa = descricao.substring(0, 30);
            payload += '62' + (descLimpa.length + 4).toString().padStart(2, '0') + 
                      '05' + descLimpa.length.toString().padStart(2, '0') + descLimpa;
        }
        
        // CRC16 (simplificado)
        payload += '6304';
        
        return payload;
        
    } catch (error) {
        console.error('Erro ao gerar payload:', error);
        return null;
    }
}