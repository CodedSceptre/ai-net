import React, { useState } from 'react';
import { FileUpload } from '../common/FileUpload';
import type { UploadedFile } from '../common/FileUpload';

interface TaskSubmissionFormProps {
  taskId?: string;
  onFilesChange?: (files: UploadedFile[]) => void;
}

/**
 * Wraps FileUpload inside the task submission context.
 * Accepted types mirror common task attachment formats.
 */
export const TaskSubmissionForm: React.FC<TaskSubmissionFormProps> = ({
  taskId,
  onFilesChange,
}) => {
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);

  const handleChange = (files: UploadedFile[]) => {
    setAttachments(files);
    onFilesChange?.(files);
  };

  return (
    <section aria-label="Task attachments">
      <h3
        style={{
          fontSize: '0.9375rem',
          fontWeight: 600,
          color: 'var(--text-primary)',
          marginBottom: '0.75rem',
        }}
      >
        Attachments{' '}
        <span
          style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'var(--text-muted)' }}
        >
          (optional)
        </span>
      </h3>
      <FileUpload
        taskId={taskId}
        acceptedTypes={['.pdf', '.ts', '.tsx', '.js', '.md', '.txt', '.png', '.jpg', '.jpeg']}
        onChange={handleChange}
      />
      {attachments.length > 0 && (
        <p
          style={{
            marginTop: '0.5rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
          }}
        >
          {attachments.filter((f) => f.status === 'success').length} of {attachments.length} file
          {attachments.length !== 1 ? 's' : ''} uploaded
        </p>
      )}
    </section>
  );
};

export default TaskSubmissionForm;
