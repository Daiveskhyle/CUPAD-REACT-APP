/**
 * Deprecated for layout use – sync lives in the header via HeaderSyncButton.
 * Kept so existing imports compile without creating empty header space.
 */
import React from "react";

type Props = {
  pendingLabel?: string;
  onSynced?: (synced: number) => void;
  compact?: boolean;
  style?: any;
};

export default function OfflineStatusBar(_props: Props) {
  return null;
}
