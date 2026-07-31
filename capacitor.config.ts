import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.neuroagentai.opendementia',
  appName: 'OpenDementia',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    // For development, you can use your local IP
    // url: 'http://192.168.1.100:3000',
    // cleartext: true
  },
  plugins: {
    Camera: {
      // Enable camera permissions
    },
    Geolocation: {
      // Enable location permissions
    },
    SplashScreen: {
      launchShowDuration: 2000,
      backgroundColor: '#667eea',
      showSpinner: false
    }
  },
  ios: {
    contentInset: 'automatic',
    // Allow inline media playback
    allowsInlineMediaPlayback: true,
    // WebView configuration
    limitsNavigationsToAppBoundDomains: false
  },
  android: {
    // Allow cleartext traffic for local development
    allowMixedContent: true,
    captureInput: true,
    // WebView configuration
    webContentsDebuggingEnabled: true
  }
};

export default config;

