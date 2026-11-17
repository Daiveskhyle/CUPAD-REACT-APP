// app/co/_layout.tsx
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Redirect } from "expo-router";

export default function CoLayout() {
  const [ready, setReady] = useState(false);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem("cupad_user").then(v => {
      setAuthed(!!v);
      setReady(true);
    });
  }, []);

  if (!ready) return null; // <-- DON'T redirect while loading, this is the bug
  if (!authed) return <Redirect href="/login" />;

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="dashboard" />
      <Stack.Screen name="clients" />
      <Stack.Screen name="collections" />
      <Stack.Screen name="loans" />
      <Stack.Screen name="profile" />
    </Stack>
  );
}