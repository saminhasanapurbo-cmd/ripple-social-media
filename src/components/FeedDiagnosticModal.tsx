import React, { useState } from 'react';
import { X, Terminal, ExternalLink, Copy, Check, RefreshCw, AlertTriangle, Database, Cloud, Shield } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { getLastFeedDiagnostic, type FeedDiagnosticInfo } from '../services/feed';

interface FeedDiagnosticModalProps {
  isOpen: boolean;
  onClose: () => void;
  feedErrorCode?: string | null;
  onRetry?: () => void;
}

export const FeedDiagnosticModal: React.FC<FeedDiagnosticModalProps> = ({
  isOpen,
  onClose,
  feedErrorCode,
  onRetry
}) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const [probeResult, setProbeResult] = useState<any>(null);

  if (!isOpen) return null;

  const diagnostic: FeedDiagnosticInfo | null = getLastFeedDiagnostic();

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const handleRunProbe = async () => {
    setProbing(true);
    setProbeResult(null);
    const startTime = Date.now();
    try {
      const getFeedV41Callable = httpsCallable<any, any>(functions, 'getFeedV41');
      const res = await getFeedV41Callable({ probeOnly: true });
      const duration = Date.now() - startTime;
      setProbeResult({
        status: 'success',
        probeType: 'probeOnly',
        targetFunction: 'getFeedV41',
        durationMs: duration,
        timestamp: new Date().toISOString(),
        data: res.data
      });
    } catch (err: any) {
      const duration = Date.now() - startTime;
      setProbeResult({
        status: 'error',
        probeType: 'probeOnly',
        targetFunction: 'getFeedV41',
        durationMs: duration,
        timestamp: new Date().toISOString(),
        code: err?.code || 'unknown',
        message: err?.message || String(err),
        details: err?.details || null
      });
    } finally {
      setProbing(false);
    }
  };

  const gcloudQuery = `resource.type="cloud_function" AND (resource.labels.function_name="getFeedV41" OR resource.labels.function_name="getFeed")`;
  const gcloudCommand = `gcloud logging read '${gcloudQuery}' --limit=30 --project=kingly-multiplexer-gbg1d --format="table(timestamp,severity,textPayload)"`;
  const firebaseLogCommand = `firebase functions:log --only getFeedV41 --project kingly-multiplexer-gbg1d`;
  const gcpConsoleUrl = `https://console.cloud.google.com/logs/query;query=resource.type%3D%22cloud_function%22%0A(resource.labels.function_name%3D%22getFeedV41%22%20OR%20resource.labels.function_name%3D%22getFeed%22)%0Aresource.labels.region%3D%22us-central1%22?project=kingly-multiplexer-gbg1d`;
  const firebaseConsoleUrl = `https://console.firebase.google.com/project/kingly-multiplexer-gbg1d/functions/logs`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-150">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <Terminal className="w-4 h-4" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 text-sm">Feed Diagnostic Inspector</h2>
              <p className="text-[11px] text-slate-500">Live Cloud Function telemetry & log inspection</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto space-y-5 text-xs text-slate-700">

          {/* Current Status Box */}
          <div className="bg-red-50/60 border border-red-200/80 rounded-xl p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
              <div className="space-y-1 w-full">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-red-900">Current Feed Status: Error</span>
                  <span className="text-[10px] text-red-600/80 font-mono">
                    {diagnostic?.timestamp ? new Date(diagnostic.timestamp).toLocaleTimeString() : 'Recent'}
                  </span>
                </div>
                <div className="text-red-800 font-mono text-[11px] bg-white/70 p-2 rounded-lg border border-red-100 break-all">
                  {feedErrorCode || diagnostic?.code || 'functions/internal'}
                </div>
                <p className="text-[11px] text-red-700/90 pt-1">
                  The client successfully connected to the Firebase Functions endpoint, but the deployed <code className="font-mono bg-red-100/70 px-1 py-0.5 rounded">getFeedV41</code> function encountered an unhandled exception or failed precondition.
                </p>
              </div>
            </div>
          </div>

          {/* Target Metadata Grid */}
          <div>
            <h3 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Cloud className="w-3.5 h-3.5 text-blue-500" />
              Endpoint Target Architecture
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <div className="text-slate-400 text-[10px]">Cloud Function</div>
                <div className="font-semibold text-slate-800 font-mono">getFeedV41</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <div className="text-slate-400 text-[10px]">Region</div>
                <div className="font-semibold text-slate-800 font-mono">us-central1</div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <div className="text-slate-400 text-[10px]">GCP Project</div>
                <div className="font-semibold text-slate-800 font-mono truncate" title="kingly-multiplexer-gbg1d">
                  kingly-multiplexer-gbg1d
                </div>
              </div>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200/60">
                <div className="text-slate-400 text-[10px]">Named Firestore</div>
                <div className="font-semibold text-slate-800 font-mono truncate" title="ai-studio-485fb845-462f-4777-a3e8-0d2bb4a8cf18">
                  ai-studio-485...
                </div>
              </div>
            </div>
          </div>

          {/* Live In-Browser Probe Tool */}
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4 text-indigo-500" />
                <span className="font-bold text-slate-900">Live Function Probe</span>
              </div>
              <button
                type="button"
                onClick={handleRunProbe}
                disabled={probing}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-lg text-xs flex items-center gap-1.5 shadow-xs transition cursor-pointer disabled:opacity-60"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${probing ? 'animate-spin' : ''}`} />
                {probing ? 'Probing getFeedV41...' : 'Trigger V41 Probe'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">
              Sends an immediate live probe request to <code className="font-mono">getFeedV41({'{ probeOnly: true }'})</code> to verify Cloud Function existence, deployment, and auth routing.
            </p>
            {probeResult && (
              <div className="mt-2 text-[11px] font-mono bg-slate-900 text-slate-100 p-3 rounded-lg overflow-x-auto border border-slate-800">
                <div className="flex justify-between text-slate-400 text-[10px] mb-1 pb-1 border-b border-slate-800">
                  <span>Status: {probeResult.status.toUpperCase()} ({probeResult.durationMs}ms)</span>
                  <span>{probeResult.timestamp}</span>
                </div>
                <pre>{JSON.stringify(probeResult, null, 2)}</pre>
              </div>
            )}
          </div>

          {/* How to view Cloud Function Logs */}
          <div className="space-y-3">
            <h3 className="font-bold text-slate-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5">
              <Database className="w-3.5 h-3.5 text-blue-500" />
              How to Inspect Real Live Logs
            </h3>

            {/* Option 1: Web Consoles */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <a
                href={gcpConsoleUrl}
                target="_blank"
                rel="noreferrer"
                className="p-3 rounded-xl border border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 transition flex items-center justify-between group"
              >
                <div>
                  <div className="font-bold text-slate-800 flex items-center gap-1">
                    Google Cloud Logs Explorer
                    <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-blue-600" />
                  </div>
                  <div className="text-[10px] text-slate-500">Live stream of server stdout/stderr</div>
                </div>
              </a>

              <a
                href={firebaseConsoleUrl}
                target="_blank"
                rel="noreferrer"
                className="p-3 rounded-xl border border-slate-200 bg-white hover:border-amber-300 hover:bg-amber-50/40 transition flex items-center justify-between group"
              >
                <div>
                  <div className="font-bold text-slate-800 flex items-center gap-1">
                    Firebase Console Logs
                    <ExternalLink className="w-3 h-3 text-slate-400 group-hover:text-amber-600" />
                  </div>
                  <div className="text-[10px] text-slate-500">Firebase dashboard function logs</div>
                </div>
              </a>
            </div>

            {/* Option 2: CLI Commands */}
            <div className="space-y-2">
              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1 font-semibold">
                  <span>View via Google Cloud CLI:</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(gcloudCommand, 'gcloud')}
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer font-normal"
                  >
                    {copiedKey === 'gcloud' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'gcloud' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="bg-slate-900 text-slate-100 font-mono text-[10px] p-2.5 rounded-lg break-all">
                  {gcloudCommand}
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1 font-semibold">
                  <span>View via Firebase CLI:</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(firebaseLogCommand, 'firebase')}
                    className="flex items-center gap-1 text-[10px] text-blue-600 hover:text-blue-700 cursor-pointer font-normal"
                  >
                    {copiedKey === 'firebase' ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                    {copiedKey === 'firebase' ? 'Copied' : 'Copy'}
                  </button>
                </div>
                <div className="bg-slate-900 text-slate-100 font-mono text-[10px] p-2.5 rounded-lg break-all">
                  {firebaseLogCommand}
                </div>
              </div>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50 flex items-center justify-between">
          <span className="text-[10px] text-slate-500">
            Build: <code className="font-mono font-bold text-slate-700">RIPPLE-V41-FEED-RESET</code>
          </span>
          <div className="flex items-center gap-2">
            {onRetry && (
              <button
                type="button"
                onClick={() => {
                  onRetry();
                  onClose();
                }}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-xs flex items-center gap-1.5 transition cursor-pointer shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Feed
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold rounded-xl text-xs transition cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
