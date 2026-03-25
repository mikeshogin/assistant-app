import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, TextInput,
  StyleSheet, Alert, Platform, StatusBar,
} from 'react-native';
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

const DEFAULT_SERVER = 'wss://your-vps:8789/ws';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [token, setToken] = useState('');
  const [connected, setConnected] = useState(false);
  const [recording, setRecording] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  const [showSettings, setShowSettings] = useState(true);
  const ws = useRef(null);
  const flatList = useRef(null);

  // Connect WebSocket
  const connect = () => {
    if (!token) {
      Alert.alert('Error', 'Enter auth token');
      return;
    }

    const url = `${serverUrl}?token=${token}`;
    ws.current = new WebSocket(url);

    ws.current.onopen = () => {
      setConnected(true);
      setShowSettings(false);
      addMessage('system', 'Connected to server');
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'reply') {
          addMessage('assistant', data.text);
        } else if (data.type === 'ack') {
          // Message acknowledged
        }
      } catch {}
    };

    ws.current.onclose = () => {
      setConnected(false);
      addMessage('system', 'Disconnected');
    };

    ws.current.onerror = (err) => {
      addMessage('system', 'Connection error');
      setConnected(false);
    };
  };

  const addMessage = (type, text) => {
    setMessages(prev => [...prev, {
      id: Date.now().toString(),
      type,
      text,
      time: new Date().toLocaleTimeString(),
    }]);
  };

  // Voice recording
  const startRecording = async () => {
    try {
      await Audio.requestPermissionsAsync();
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );
      setRecording(recording);
      setIsRecording(true);
    } catch (err) {
      Alert.alert('Error', 'Failed to start recording');
    }
  };

  const stopRecording = async () => {
    if (!recording) return;

    setIsRecording(false);
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    setRecording(null);

    if (uri) {
      await sendVoice(uri);
    }
  };

  const sendVoice = async (uri) => {
    addMessage('user', '[voice message]');

    try {
      // Read file as base64
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });

      // Send via HTTP (WebSocket can't handle binary well on RN)
      const httpUrl = serverUrl
        .replace('wss://', 'https://')
        .replace('ws://', 'http://')
        .replace('/ws', '/voice');

      const formData = new FormData();
      formData.append('audio', {
        uri: Platform.OS === 'ios' ? uri.replace('file://', '') : uri,
        type: 'audio/m4a',
        name: 'voice.m4a',
      });

      const response = await fetch(httpUrl, {
        method: 'POST',
        headers: { 'x-auth-token': token },
        body: formData,
      });

      const data = await response.json();

      if (data.transcription) {
        // Update last user message with transcription
        setMessages(prev => {
          const updated = [...prev];
          const lastUser = updated.findLast(m => m.type === 'user');
          if (lastUser) lastUser.text = data.transcription;
          return updated;
        });
      }
    } catch (err) {
      addMessage('system', `Send error: ${err.message}`);
    }
  };

  // Auto-scroll
  useEffect(() => {
    if (flatList.current && messages.length > 0) {
      flatList.current.scrollToEnd({ animated: true });
    }
  }, [messages]);

  // Settings screen
  if (showSettings) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="light-content" />
        <View style={styles.settings}>
          <Text style={styles.title}>GenieArchi</Text>
          <Text style={styles.subtitle}>Voice-first AI assistant</Text>

          <Text style={styles.label}>Server URL</Text>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="wss://your-server:8789/ws"
            placeholderTextColor="#64748b"
          />

          <Text style={styles.label}>Auth Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="your-token"
            placeholderTextColor="#64748b"
            secureTextEntry
          />

          <TouchableOpacity style={styles.connectBtn} onPress={connect}>
            <Text style={styles.connectBtnText}>Connect</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Chat screen
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      <View style={styles.header}>
        <TouchableOpacity onPress={() => setShowSettings(true)}>
          <Text style={styles.headerBack}>Settings</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>GenieArchi</Text>
        <View style={[styles.dot, connected ? styles.dotGreen : styles.dotRed]} />
      </View>

      <FlatList
        ref={flatList}
        style={styles.messages}
        data={messages}
        keyExtractor={item => item.id}
        renderItem={({ item }) => (
          <View style={[
            styles.message,
            item.type === 'user' ? styles.msgUser :
            item.type === 'assistant' ? styles.msgAssistant :
            styles.msgSystem
          ]}>
            <Text style={item.type === 'system' ? styles.msgSystemText : styles.msgText}>
              {item.text}
            </Text>
            <Text style={styles.msgTime}>{item.time}</Text>
          </View>
        )}
      />

      <View style={styles.controls}>
        <TouchableOpacity
          style={[styles.recordBtn, isRecording && styles.recordBtnActive]}
          onPressIn={startRecording}
          onPressOut={stopRecording}
        >
          <Text style={styles.recordBtnText}>
            {isRecording ? 'Recording...' : 'Hold to Talk'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f172a' },

  // Settings
  settings: { flex: 1, justifyContent: 'center', padding: 24 },
  title: { fontSize: 32, fontWeight: '700', color: '#e2e8f0', textAlign: 'center', marginBottom: 4 },
  subtitle: { fontSize: 16, color: '#64748b', textAlign: 'center', marginBottom: 32 },
  label: { color: '#94a3b8', fontSize: 14, marginBottom: 4, marginTop: 16 },
  input: { backgroundColor: '#1e293b', color: '#e2e8f0', padding: 14, borderRadius: 8, fontSize: 16 },
  connectBtn: { backgroundColor: '#2563eb', padding: 16, borderRadius: 8, marginTop: 24, alignItems: 'center' },
  connectBtnText: { color: '#fff', fontSize: 18, fontWeight: '600' },

  // Header
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingTop: 48, borderBottomWidth: 1, borderBottomColor: '#1e293b' },
  headerBack: { color: '#2563eb', fontSize: 14 },
  headerTitle: { flex: 1, color: '#e2e8f0', fontSize: 18, fontWeight: '600', textAlign: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotGreen: { backgroundColor: '#22c55e' },
  dotRed: { backgroundColor: '#ef4444' },

  // Messages
  messages: { flex: 1, padding: 12 },
  message: { maxWidth: '85%', padding: 12, borderRadius: 12, marginBottom: 8 },
  msgUser: { alignSelf: 'flex-end', backgroundColor: '#2563eb' },
  msgAssistant: { alignSelf: 'flex-start', backgroundColor: '#1e293b' },
  msgSystem: { alignSelf: 'center' },
  msgText: { color: '#e2e8f0', fontSize: 15, lineHeight: 22 },
  msgSystemText: { color: '#64748b', fontSize: 13, textAlign: 'center' },
  msgTime: { color: '#94a3b8', fontSize: 11, marginTop: 4, textAlign: 'right' },

  // Controls
  controls: { padding: 16, borderTopWidth: 1, borderTopColor: '#1e293b' },
  recordBtn: { backgroundColor: '#1e293b', padding: 20, borderRadius: 12, alignItems: 'center', borderWidth: 2, borderColor: '#2563eb' },
  recordBtnActive: { backgroundColor: '#dc2626', borderColor: '#dc2626' },
  recordBtnText: { color: '#e2e8f0', fontSize: 18, fontWeight: '600' },
});
