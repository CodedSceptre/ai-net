import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  FileText,
  FileCode,
  FileImage,
  File,
  X,
  UploadCloud,
  CheckCircle,
  AlertCircle,
} from 'lucide-react';
import styles from './FileUpload.module.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TOTAL_BYTES = 50 * 1024 * 1024; // 50 MB
const MAX_FILES = 5;

// ── Types ──────────────────────────────────────────────────────────────────────

export type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';

export interface UploadedFile {
  id: string;
  file: File;
  status: UploadStatus;
  progress: number; // 0-100
  error?: string;
}

export interface FileUploadProps {
  /** Accepted file extensions, e.g. ['.pdf', '.ts', '.tsx', '.md'] */
  acceptedTypes?: string[];
  /** Called when the file list changes (after all uploads settle) */
  onChange?: (files: UploadedFile[]) => void;
  /** Task ID used for the upload endpoint */
  taskId?: string;
  disabled?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileIcon(file: File): React.ReactNode {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go'].includes(ext))
    return <FileCode size={18} aria-hidden />;
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext))
    return <FileImage size={18} aria-hidden />;
  if (ext === 'pdf' || ['md', 'txt', 'doc', 'docx'].includes(ext))
    return <FileText size={18} aria-hidden />;
  return <File size={18} aria-hidden />;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function validateFile(
  file: File,
  acceptedTypes: string[],
  existingTotalBytes: number,
): string | null {
  if (acceptedTypes.length > 0) {
    const ext = `.${file.name.split('.').pop()?.toLowerCase() ?? ''}`;
    if (!acceptedTypes.map((t) => t.toLowerCase()).includes(ext)) {
      return `Only ${acceptedTypes.join(', ')} files accepted`;
    }
  }
  if (file.size > MAX_FILE_BYTES) {
    return `Max ${formatBytes(MAX_FILE_BYTES)} per file`;
  }
  if (existingTotalBytes + file.size > MAX_TOTAL_BYTES) {
    return `Total upload limit is ${formatBytes(MAX_TOTAL_BYTES)}`;
  }
  return null;
}

/** Simulated upload: fires progress events over ~1.5 s then resolves. */
async function simulateUpload(
  taskId: string | undefined,
  file: File,
  onProgress: (pct: number) => void,
): Promise<void> {
  // If a real endpoint exists, replace the simulation below.
  const STEPS = 10;
  for (let i = 1; i <= STEPS; i++) {
    await new Promise<void>((r) => setTimeout(r, 120 + Math.random() * 60));
    onProgress(Math.round((i / STEPS) * 100));
  }
  // Real implementation would be:
  //   const form = new FormData();
  //   form.append('file', file);
  //   await fetch(`/api/tasks/${taskId}/attachments`, { method: 'POST', body: form });
  void taskId;
}

// ── Component ──────────────────────────────────────────────────────────────────

export const FileUpload: React.FC<FileUploadProps> = ({
  acceptedTypes = [],
  onChange,
  taskId,
  disabled = false,
}) => {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const totalBytes = files.reduce((sum, f) => sum + f.file.size, 0);

  // Notify parent whenever files list changes.
  useEffect(() => {
    onChange?.(files);
  }, [files, onChange]);

  // ── Paste from clipboard ────────────────────────────────────────────────────
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      if (disabled) return;
      const items = Array.from(e.clipboardData?.items ?? []);
      const imageFiles = items
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((f): f is File => f !== null);
      if (imageFiles.length) addFiles(imageFiles);
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, files]);

  // ── Core: add files ────────────────────────────────────────────────────────

  const addFiles = useCallback(
    (incoming: File[]) => {
      const newEntries: UploadedFile[] = [];
      let runningTotal = totalBytes;

      for (const file of incoming) {
        if (files.length + newEntries.length >= MAX_FILES) break;
        const error = validateFile(file, acceptedTypes, runningTotal);
        const entry: UploadedFile = {
          id: uid(),
          file,
          status: error ? 'error' : 'uploading',
          progress: 0,
          error: error ?? undefined,
        };
        newEntries.push(entry);
        if (!error) runningTotal += file.size;
      }

      setFiles((prev) => [...prev, ...newEntries]);

      // Start uploads for valid entries.
      for (const entry of newEntries) {
        if (entry.status !== 'uploading') continue;
        simulateUpload(taskId, entry.file, (pct) => {
          setFiles((prev) =>
            prev.map((f) => (f.id === entry.id ? { ...f, progress: pct } : f)),
          );
        })
          .then(() => {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === entry.id ? { ...f, status: 'success', progress: 100 } : f,
              ),
            );
          })
          .catch(() => {
            setFiles((prev) =>
              prev.map((f) =>
                f.id === entry.id ? { ...f, status: 'error', error: 'Upload failed' } : f,
              ),
            );
          });
      }
    },
    [files, totalBytes, acceptedTypes, taskId],
  );

  const removeFile = useCallback((id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id));
  }, []);

  // ── Drag & drop ────────────────────────────────────────────────────────────

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled) setDragOver(true);
  };
  const handleDragLeave = () => setDragOver(false);
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (disabled) return;
    addFiles(Array.from(e.dataTransfer.files));
  };

  // ── File input ─────────────────────────────────────────────────────────────

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
    e.target.value = '';
  };

  const atLimit = files.length >= MAX_FILES;
  const acceptAttr = acceptedTypes.join(',');

  return (
    <div className={styles.root} data-testid="file-upload">
      {/* Drop zone */}
      <div
        className={[
          styles.dropZone,
          dragOver ? styles.dragOver : '',
          disabled || atLimit ? styles.disabled : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !disabled && !atLimit && inputRef.current?.click()}
        role="button"
        tabIndex={disabled || atLimit ? -1 : 0}
        aria-label={
          atLimit
            ? `Maximum ${MAX_FILES} files reached`
            : 'Drop files here or click to browse'
        }
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !disabled && !atLimit) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        data-testid="file-upload-dropzone"
      >
        <UploadCloud size={32} className={styles.uploadIcon} aria-hidden />
        <p className={styles.dropLabel}>
          {atLimit ? (
            <span>Maximum {MAX_FILES} files reached</span>
          ) : (
            <>
              <span className={styles.browseLink}>Click to browse</span>
              {' '}or drag &amp; drop
            </>
          )}
        </p>
        <p className={styles.dropHint}>
          {acceptedTypes.length > 0
            ? `${acceptedTypes.join(', ')} · max ${formatBytes(MAX_FILE_BYTES)} per file · up to ${MAX_FILES} files`
            : `Max ${formatBytes(MAX_FILE_BYTES)} per file · up to ${MAX_FILES} files`}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={acceptAttr || undefined}
          className={styles.hiddenInput}
          onChange={handleInputChange}
          disabled={disabled || atLimit}
          aria-hidden="true"
          tabIndex={-1}
        />
      </div>

      {/* File list */}
      {files.length > 0 && (
        <ul className={styles.fileList} aria-label="Uploaded files">
          {files.map((uf) => (
            <li key={uf.id} className={styles.fileItem} data-testid="file-item">
              <span className={styles.fileIcon}>{fileIcon(uf.file)}</span>

              <div className={styles.fileInfo}>
                <span className={styles.fileName}>{uf.file.name}</span>
                <span className={styles.fileMeta}>
                  {formatBytes(uf.file.size)}
                  {uf.status === 'error' && uf.error && (
                    <span className={styles.errorText}> · {uf.error}</span>
                  )}
                </span>

                {/* Progress bar */}
                {uf.status === 'uploading' && (
                  <div
                    className={styles.progressTrack}
                    role="progressbar"
                    aria-valuenow={uf.progress}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`Uploading ${uf.file.name}: ${uf.progress}%`}
                  >
                    <div
                      className={styles.progressFill}
                      style={{ width: `${uf.progress}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Status icon */}
              <span className={styles.statusIcon} aria-hidden="true">
                {uf.status === 'success' && (
                  <CheckCircle size={16} className={styles.iconSuccess} />
                )}
                {uf.status === 'error' && (
                  <AlertCircle size={16} className={styles.iconError} />
                )}
              </span>

              {/* Remove button */}
              <button
                type="button"
                className={styles.removeBtn}
                onClick={() => removeFile(uf.id)}
                aria-label={`Remove ${uf.file.name}`}
                data-testid="file-remove"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default FileUpload;
