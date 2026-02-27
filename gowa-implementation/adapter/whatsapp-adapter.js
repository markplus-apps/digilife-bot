/**
 * WhatsApp API Adapter Layer
 * 
 * This adapter abstracts away the underlying API provider (Fonnte or GOWA)
 * Allows seamless switching between providers without changing business logic
 * 
 * Usage in digilife-service.js:
 * const whatsappAdapter = require('./whatsapp-adapter');
 * await whatsappAdapter.sendMessage(chatId, text);
 */

const axios = require('axios');

// ========== CONFIGURATION ==========
const CONFIG = {
  provider: process.env.WHATSAPP_PROVIDER || 'fonnte', // 'fonnte' or 'gowa'
  
  // Fonnte Configuration
  // Note: Uses fonnte-bot.js local gateway (NOT direct Fonnte API)
  // fonnte-bot.js runs on port 3010 and handles the Fonnte API token internally
  fonnte: {
    baseUrl: process.env.BOT_API_URL || 'http://localhost:3010/send-message',
  },
  
  // GOWA Configuration
  gowa: {
    baseUrl: process.env.GOWA_API_URL || 'http://localhost:3006/api',
    sessionId: process.env.GOWA_SESSION_ID || 'default',
    basicAuth: process.env.GOWA_BASIC_AUTH || null, // 'username:password'
  },
};

// ========== ADAPTER INTERFACE ==========
class WhatsAppAdapter {
  constructor(config) {
    this.config = config;
    this.provider = config.provider;
    this.setProvider(this.provider);
  }

  /**
   * Switch between providers at runtime
   */
  setProvider(provider) {
    if (!['fonnte', 'gowa'].includes(provider)) {
      throw new Error(`Invalid provider: ${provider}. Must be 'fonnte' or 'gowa'`);
    }
    this.provider = provider;
    console.log(`🔄 WhatsApp Provider switched to: ${provider.toUpperCase()}`);
  }

  /**
   * Send text message
   */
  async sendMessage(chatId, text) {
    try {
      if (this.provider === 'fonnte') {
        return await this._sendMessageFonnte(chatId, text);
      } else {
        return await this._sendMessageGOWA(chatId, text);
      }
    } catch (error) {
      console.error(`❌ Error sending message (${this.provider}):`, error.message);
      throw error;
    }
  }

  /**
   * Send image/media
   */
  async sendImage(chatId, imageUrl, caption = '') {
    try {
      if (this.provider === 'fonnte') {
        return await this._sendImageFonnte(chatId, imageUrl, caption);
      } else {
        return await this._sendImageGOWA(chatId, imageUrl, caption);
      }
    } catch (error) {
      console.error(`❌ Error sending image (${this.provider}):`, error.message);
      throw error;
    }
  }

  /**
   * Get connection status
   */
  async getStatus() {
    try {
      if (this.provider === 'fonnte') {
        return await this._getStatusFonnte();
      } else {
        return await this._getStatusGOWA();
      }
    } catch (error) {
      console.error(`❌ Error getting status (${this.provider}):`, error.message);
      throw error;
    }
  }

  /**
   * Get provider info
   */
  getProviderInfo() {
    return {
      provider: this.provider,
      baseUrl: this.provider === 'fonnte' 
        ? this.config.fonnte.baseUrl 
        : this.config.gowa.baseUrl,
      status: 'active',
    };
  }

  // ========== FONNTE IMPLEMENTATIONS ==========

  async _sendMessageFonnte(chatId, text) {
    // Uses fonnte-bot.js local gateway (localhost:3010)
    // Correct format: { to, text } — same as what digilife-service.js uses
    const response = await axios.post(this.config.fonnte.baseUrl, {
      to: chatId,
      text: text,
    });
    
    return {
      provider: 'fonnte',
      status: response.data?.status === true ? 'success' : 'sent',
      timestamp: new Date(),
    };
  }

  async _sendImageFonnte(chatId, imageUrl, caption) {
    // Uses fonnte-bot.js local gateway (localhost:3010)
    const response = await axios.post(this.config.fonnte.baseUrl, {
      to: chatId,
      text: caption || '',
      file: imageUrl,
    });
    
    return {
      provider: 'fonnte',
      status: response.data?.status === true ? 'success' : 'sent',
      timestamp: new Date(),
    };
  }

  async _getStatusFonnte() {
    try {
      // Ping the local gateway to check if it's up
      const response = await axios.get(
        this.config.fonnte.baseUrl.replace('/send-message', '/health')
      );
      return {
        provider: 'fonnte',
        isConnected: !!response.data,
        status: 'connected',
        gateway: this.config.fonnte.baseUrl,
      };
    } catch (error) {
      return {
        provider: 'fonnte',
        isConnected: false,
        status: 'gateway_unreachable',
        error: error.message,
      };
    }
  }

  // ========== GOWA IMPLEMENTATIONS ==========

  async _sendMessageGOWA(chatId, text) {
    const payload = {
      chatId: chatId,
      text: text,
      session: this.config.gowa.sessionId,
    };

    const headers = { 'Content-Type': 'application/json' };
    
    // Add basic auth if configured
    if (this.config.gowa.basicAuth) {
      const [username, password] = this.config.gowa.basicAuth.split(':');
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }

    const response = await axios.post(
      `${this.config.gowa.baseUrl}/send/message`,
      payload,
      { headers }
    );
    
    return {
      provider: 'gowa',
      messageId: response.data.data?.message_id,
      status: response.data.success ? 'success' : 'failed',
      timestamp: new Date(),
    };
  }

  async _sendImageGOWA(chatId, imageUrl, caption) {
    const formData = new FormData();
    formData.append('chatId', chatId);
    formData.append('url', imageUrl); // GOWA expects 'url' for images
    if (caption) formData.append('caption', caption);
    formData.append('session', this.config.gowa.sessionId);

    const headers = { 'Content-Type': 'multipart/form-data' };
    
    if (this.config.gowa.basicAuth) {
      const [username, password] = this.config.gowa.basicAuth.split(':');
      headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
    }

    const response = await axios.post(
      `${this.config.gowa.baseUrl}/send/image`,
      formData,
      { headers }
    );
    
    return {
      provider: 'gowa',
      messageId: response.data.data?.message_id,
      status: response.data.success ? 'success' : 'failed',
      timestamp: new Date(),
    };
  }

  async _getStatusGOWA() {
    try {
      const headers = {};
      
      if (this.config.gowa.basicAuth) {
        const [username, password] = this.config.gowa.basicAuth.split(':');
        headers['Authorization'] = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
      }

      const response = await axios.get(
        `${this.config.gowa.baseUrl}/app/status`,
        { headers }
      );
      
      return {
        provider: 'gowa',
        isConnected: response.data.data?.status === 'connected',
        status: response.data.data?.status || 'unknown',
        phone: response.data.data?.phone,
      };
    } catch (error) {
      return {
        provider: 'gowa',
        isConnected: false,
        status: 'disconnected',
        error: error.message,
      };
    }
  }
}

// ========== SINGLETON INSTANCE ==========
let adapterInstance = null;

/**
 * Initialize adapter with configuration from environment
 */
function initializeAdapter() {
  if (!adapterInstance) {
    adapterInstance = new WhatsAppAdapter(CONFIG);
    console.log(`✅ WhatsApp Adapter initialized (Provider: ${CONFIG.provider.toUpperCase()})`);
  }
  return adapterInstance;
}

/**
 * Get adapter instance
 */
function getAdapter() {
  if (!adapterInstance) {
    return initializeAdapter();
  }
  return adapterInstance;
}

// ========== EXPORTS ==========
module.exports = {
  initializeAdapter,
  getAdapter,
  WhatsAppAdapter,
  
  // Convenience functions
  sendMessage: (chatId, text) => getAdapter().sendMessage(chatId, text),
  sendImage: (chatId, imageUrl, caption) => getAdapter().sendImage(chatId, imageUrl, caption),
  getStatus: () => getAdapter().getStatus(),
  getProviderInfo: () => getAdapter().getProviderInfo(),
  switchProvider: (provider) => getAdapter().setProvider(provider),
};
