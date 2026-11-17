import { Stack, Redirect } from "expo-router";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { startAutoSync, stopAutoSync, requestSyncNow } from "../../src/db/autoSync";

export default function CoLayout() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const load = async () => {
      const user = await AsyncStorage.getItem("cupad_user");
      setAuthed(!!user);
      setReady(true);
    };
    load();
  }, []);

  // Global auto-sync for ALL CO pages when network is available
  useEffect(() => {
    if (!authed) return;

    startAutoSync();

    // Extra kick when layout is focused / remounted
    requestSyncNow({ force: false, hydrate: true }).catch(() => {});

    return () => {
      // Keep listeners alive for the whole CO session;
      // only stop if user logs out (authed becomes false on unmount of tree).
      // stopAutoSync() is intentionally NOT called here so background polls continue
      // while navigating between CO screens. Cleanup on full unmount:
      stopAutoSync();
    };
  }, [authed]);

  if (!ready) return null;
  if (!authed) return <Redirect href="/login" />;

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    />
  );
}
