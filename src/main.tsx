import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';

export const BUILD_ID = 'RIPPLE-V41-FEED-RESET';

let appMounted = false;

function getErrorCode(err: any): string {
  if (!err) return 'UNKNOWN_STARTUP_ERROR';
  const msg = String(err?.message || err);
  if (msg.includes('ROOT')) return 'ROOT_MISSING';
  if (msg.includes('firebase') || msg.includes('firestore') || msg.includes('auth')) return 'FIREBASE_INIT_FAILED';
  if (msg.includes('dynamically') || msg.includes('Failed to fetch dynamically imported module') || msg.includes('import')) {
    return 'MODULE_LOAD_FAILED';
  }
  return 'UNKNOWN_STARTUP_ERROR';
}

function renderBootstrapFailure(error: any) {
  if (appMounted) return;
  const root = document.getElementById('root');
  if (!root) return;

  const code = getErrorCode(error);
  console.error('[Ripple] bootstrap failed:', error);

  root.innerHTML = `
    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 100vh; background-color: #f8fafc; font-family: system-ui, -apple-system, sans-serif; color: #0f172a; padding: 1.5rem; text-align: center;">
      <div style="max-width: 28rem; width: 100%; background: white; border: 1px solid #e2e8f0; border-radius: 1rem; padding: 2rem; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);">
        <div style="width: 48px; height: 48px; background: #fee2e2; color: #dc2626; border-radius: 12px; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 20px; margin: 0 auto 1rem auto;">!</div>
        <h2 style="font-size: 1.25rem; font-weight: 800; margin: 0 0 0.5rem 0; color: #0f172a;">Ripple couldn't start</h2>
        <p style="font-size: 0.875rem; color: #64748b; margin: 0 0 1.5rem 0; line-height: 1.5;">Something prevented Ripple from starting correctly.</p>
        <div style="margin-bottom: 1.5rem;">
          <button onclick="window.location.reload()" style="background: #2563eb; color: white; border: none; padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 700; border-radius: 0.75rem; cursor: pointer; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.25);">Reload</button>
        </div>
        <div style="font-size: 0.75rem; color: #94a3b8; border-top: 1px solid #f1f5f9; padding-top: 1rem; display: flex; justify-content: space-between; align-items: center;">
          <span>Build: RIPPLE-V41-FEED-RESET</span>
          <span style="font-family: monospace; background: #f1f5f9; padding: 0.125rem 0.375rem; border-radius: 0.25rem; color: #475569;">${code}</span>
        </div>
      </div>
    </div>
  `;
}

window.addEventListener('error', (event) => {
  if (!appMounted) renderBootstrapFailure(event.error || event.message);
});

window.addEventListener('unhandledrejection', (event) => {
  if (!appMounted) renderBootstrapFailure(event.reason);
});

async function bootstrap() {
  console.info('[Ripple] bootstrap started');
  try {
    const root = document.getElementById('root');
    if (!root) throw new Error('ROOT_ELEMENT_MISSING');

    const [
      { default: App },
      { AuthProvider },
      { ErrorBoundary }
    ] = await Promise.all([
      import('./App'),
      import('./context/AuthContext'),
      import('./components/ErrorBoundary')
    ]);

    createRoot(root).render(
      <StrictMode>
        <ErrorBoundary>
          <AuthProvider>
            <App />
          </AuthProvider>
        </ErrorBoundary>
      </StrictMode>
    );

    appMounted = true;
  } catch (error) {
    renderBootstrapFailure(error);
  }
}

bootstrap();
