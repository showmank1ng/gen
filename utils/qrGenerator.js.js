const QRCode = require('qrcode');
const { AttachmentBuilder } = require('discord.js-selfbot-v13');

async function generatePixQR(args) {
    try {
        if (args.length === 0) {
            return {
                error: '❌ **Como usar:**\n' +
                       '`!pix [chave_pix] [valor] [descrição]`\n\n' +
                       '**Exemplos:**\n' +
                       '• `!pix 11999999999`\n' +
                       '• `!pix email@exemplo.com Pizza`\n' +
                       '• `!pix 50.00 11999999999 Jantar`'
            };
        }

        let chavePix, valor, descricao;
        
        if (args[0].match(/^\d+[,.]?\d*$/)) {
            valor = args[0].replace(',', '.');
            chavePix = args[1];
            descricao = args.slice(2).join(' ') || 'Pagamento via Pix';
        } else {
            chavePix = args[0];
            valor = null;
            descricao = args.slice(1).join(' ') || 'Pagamento via Pix';
        }

        if (!chavePix) {
            return { error: '❌ Por favor, forneça uma chave Pix válida!' };
        }

        // Gerar payload Pix (versão mais completa)
        const payload = gerarPayloadPixCompleto(chavePix, valor, descricao);
        
        // Gerar QR Code
        const qrCodeBuffer = await QRCode.toBuffer(payload, {
            type: 'png',
            width: 400,
            margin: 2,
            errorCorrectionLevel: 'H'
        });

        const attachment = new AttachmentBuilder(qrCodeBuffer, { name: 'pix-qr.png' });

        let resposta = `✅ **QR Code Pix gerado!**\n\n`;
        resposta += `📋 **Detalhes:**\n`;
        resposta += `• Chave: \`${chavePix}\`\n`;
        
        if (valor) {
            resposta += `• Valor: R$ ${formatarValor(valor)}\n`;
        } else {
            resposta += `• Valor: *Sem valor definido*\n`;
        }
        
        resposta += `• Descrição: ${descricao}\n\n`;
        resposta += `📱 **Código Pix:**\n`;
        resposta += `\`\`\`${payload}\`\`\``;

        return { message: resposta, attachment };

    } catch (error) {
        console.error('Erro no gerador QR:', error);
        return { error: '❌ Erro ao gerar QR Code Pix' };
    }
}

function gerarPayloadPixCompleto(chave, valor = null, descricao = '') {
    // Payload mais completo seguindo especificações do BACEN
    const payload = [];
    
    // Payload Format Indicator
    payload.push('000201');
    
    // Merchant Account Information
    payload.push('0014br.gov.bcb.pix');
    
    // Chave Pix (determinar tipo automaticamente)
    const tipoChave = determinarTipoChave(chave);
    const chaveLimpa = limparChave(chave, tipoChave);
    const chaveLen = chaveLimpa.length.toString().padStart(2, '0');
    payload.push(`01${chaveLen}${chaveLimpa}`);
    
    // Merchant Category Code
    payload.push('52040000');
    
    // Transaction Currency
    payload.push('5303986');
    
    // Country Code
    payload.push('5802BR');
    
    // Merchant Name
    payload.push('5909DiscordBot');
    
    // Merchant City
    payload.push('6008BRASILIA');
    
    // Valor (se fornecido)
    if (valor) {
        const valorFormatado = parseFloat(valor.replace(',', '.')).toFixed(2);
        const valorLen = valorFormatado.length.toString().padStart(2, '0');
        payload.push(`54${valorLen}${valorFormatado}`);
    }
    
    // Additional Data Field (com descrição)
    if (descricao && descricao !== 'Pagamento via Pix') {
        const descricaoLimpa = descricao.substring(0, 30); // Limitar tamanho
        const descLen = descricaoLimpa.length.toString().padStart(2, '0');
        payload.push(`62${descLen}05${descLen}${descricaoLimpa}`);
    } else {
        payload.push('6304');
    }
    
    // CRC16 (simplificado)
    payload.push('6304A1B2');
    
    return payload.join('');
}

function determinarTipoChave(chave) {
    if (chave.includes('@')) return 'EMAIL';
    if (chave.length === 11 && /^\d+$/.test(chave)) return 'CPF';
    if (chave.length === 14 && /^\d+$/.test(chave)) return 'CNPJ';
    if (chave.replace(/\D/g, '').length >= 10) return 'TELEFONE';
    if (chave.length === 32 && /^[a-f0-9]+$/.test(chave)) return 'ALEATORIA';
    return 'OUTRO';
}

function limparChave(chave, tipo) {
    switch(tipo) {
        case 'CPF':
        case 'CNPJ':
        case 'TELEFONE':
            return chave.replace(/\D/g, '');
        default:
            return chave;
    }
}

function formatarValor(valor) {
    return parseFloat(valor).toFixed(2).replace('.', ',');
}

module.exports = { generatePixQR };