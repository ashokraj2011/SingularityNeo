import { useCallback, useEffect, useRef, useState } from 'react';

type DockUpload = {
  id: string;
  file: File;
  previewUrl?: string;
  kind: 'image' | 'file';
};

type UseOrchestratorDockArgs = {
  view: 'board' | 'list';
  selectedWorkItemId: string | null;
  workspaceMessageCount: number;
  showError: (title: string, description?: string) => void;
};

export const useOrchestratorDock = ({
  view,
  selectedWorkItemId,
  workspaceMessageCount,
  showError,
}: UseOrchestratorDockArgs) => {
  const [dockInput, setDockInput] = useState('');
  const [dockDraft, setDockDraft] = useState('');
  const [dockError, setDockError] = useState('');
  const [isDockSending, setIsDockSending] = useState(false);
  const [dockUploads, setDockUploads] = useState<DockUpload[]>([]);
  const dockUploadsRef = useRef(dockUploads);
  const dockThreadRef = useRef<HTMLDivElement | null>(null);
  const dockTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dockStickToBottomRef = useRef(true);
  const dockScrollFrameRef = useRef(0);
  const dockRequestRef = useRef(0);

  useEffect(() => {
    dockUploadsRef.current = dockUploads;
  }, [dockUploads]);

  useEffect(() => {
    return () => {
      dockUploadsRef.current.forEach(item => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
    };
  }, []);

  const focusDockComposer = useCallback(() => {
    window.requestAnimationFrame(() => {
      dockTextareaRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    if (view !== 'list') {
      return;
    }

    const thread = dockThreadRef.current;
    if (!thread) {
      return;
    }

    if (!dockStickToBottomRef.current && !isDockSending && !dockDraft) {
      return;
    }

    thread.scrollTop = thread.scrollHeight;
  }, [dockDraft, isDockSending, selectedWorkItemId, view, workspaceMessageCount]);

  const addDockUploadFiles = useCallback((files: FileList | File[] | null) => {
    if (!files) {
      return;
    }

    const incoming = Array.from(files);
    if (incoming.length === 0) {
      return;
    }

    const MAX_FILES = 5;
    const MAX_FILE_BYTES = 10 * 1024 * 1024;

    setDockUploads(current => {
      const availableSlots = Math.max(0, MAX_FILES - current.length);
      if (availableSlots === 0) {
        showError('Upload limit reached', `Only ${MAX_FILES} files can be attached at once.`);
        return current;
      }

      const next = [...current];
      incoming.slice(0, availableSlots).forEach(file => {
        if (file.size > MAX_FILE_BYTES) {
          showError('File too large', `${file.name} exceeds 10MB and was skipped.`);
          return;
        }

        const id = `dock-upload-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
        const isImage = file.type.startsWith('image/');
        const previewUrl = isImage ? URL.createObjectURL(file) : undefined;

        next.push({
          id,
          file,
          previewUrl,
          kind: isImage ? 'image' : 'file',
        });
      });

      return next;
    });
  }, [showError]);

  const removeDockUpload = useCallback((id: string) => {
    setDockUploads(current => {
      const target = current.find(item => item.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return current.filter(item => item.id !== id);
    });
  }, []);

  const clearDockUploads = useCallback(() => {
    setDockUploads(current => {
      current.forEach(item => {
        if (item.previewUrl) {
          URL.revokeObjectURL(item.previewUrl);
        }
      });
      return [];
    });
  }, []);

  return {
    dockInput,
    setDockInput,
    dockDraft,
    setDockDraft,
    dockError,
    setDockError,
    isDockSending,
    setIsDockSending,
    dockUploads,
    setDockUploads,
    dockUploadsRef,
    dockThreadRef,
    dockTextareaRef,
    dockStickToBottomRef,
    dockScrollFrameRef,
    dockRequestRef,
    focusDockComposer,
    addDockUploadFiles,
    removeDockUpload,
    clearDockUploads,
  };
};
