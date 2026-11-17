/**
 * CO screen shell – your original Header + BottomNavbar chrome.
 * Sync lives only in Header (HeaderSyncButton).
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import Header from "./Header";
import BottomNavbar from "./BottomNavbar";

type Props = {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  showBack?: boolean;
  hideHeader?: boolean;
  hideNav?: boolean;
  unreadCount?: number;
  onNotificationPress?: () => void;
  backgroundColor?: string;
};

export default function CoScreenWrapper({
  children,
  title,
  subtitle,
  showBack = false,
  hideHeader = false,
  hideNav = false,
  unreadCount,
  onNotificationPress,
  backgroundColor = "transparent",
}: Props) {
  return (
    <View style={[styles.root, { backgroundColor }]}>
      {!hideHeader && (
        <Header
          title={title}
          subtitle={subtitle}
          showBack={showBack}
          unreadCount={unreadCount}
          onNotificationPress={onNotificationPress}
        />
      )}
      <View style={styles.body}>{children}</View>
      {!hideNav && <BottomNavbar />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1 },
});
