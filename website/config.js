/**
 * KaiFlow website — public configuration.
 * Supabase anon key is publishable (same as the mobile app client).
 */
window.KAIFLOW_CONFIG = {
    supabaseUrl: 'https://vcivtjwreybaxgtdhtou.supabase.co',
    supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZjaXZ0andyZXliYXhndGRodG91Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMzMDAzNTAsImV4cCI6MjA4ODg3NjM1MH0.zgeJXXiO1QReTu2S2StvGy32LK6PjOk-FTS2DUrq5Jg',
    productName: 'KaiFlow',
    brandName: 'KaiSync Workforce',
    supportEmail: 'kaisynctech@gmail.com',
    /** Used when app_versions rows have no hosted download URLs yet. */
    fallbackDownloads: {
        windows: 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/latest',
        android: 'https://github.com/kaisynctech/KaiSyncWorkforce-App/releases/latest'
    }
};
