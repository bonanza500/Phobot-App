export type TimeoutAction = 'choose-frame' | 'confirm-frame' | 'auto-pick' | 'finish-edit' | 'confirm-output' | 'auto-complete' | null;

export function timeoutAction(status: string | undefined): TimeoutAction {
  switch (status) {
    case 'REVIEW': return 'choose-frame';
    case 'PHOTO_SELECTION': return 'auto-pick';
    case 'EDITING': return 'finish-edit';
    case 'FINAL_PREVIEW': return 'confirm-output';
    case 'FRAME_SELECTION': return 'confirm-frame';
    default: return 'auto-complete';
  }
}
