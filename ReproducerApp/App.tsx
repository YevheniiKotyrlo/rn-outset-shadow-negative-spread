import { StatusBar, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

type ShadowCase = {
  readonly label: string;
  readonly style: ViewStyle;
  readonly code: string;
};

const shadowCases: readonly ShadowCase[] = [
  {
    label: 'view whose spread empties its shadow shape',
    style: { boxShadow: '0 40px 0 -30px black' },
    code: "boxShadow: '0 40px 0 -30px black'",
  },
  {
    label: 'rounded view whose spread empties its shadow shape',
    style: { borderRadius: 8, boxShadow: '0 40px 0 -30px black' },
    code: "borderRadius: 8, boxShadow: '0 40px 0 -30px black'",
  },
  {
    label: 'view whose spread leaves a shadow shape',
    style: { boxShadow: '0 40px 0 -20px black' },
    code: "boxShadow: '0 40px 0 -20px black'",
  },
];

function App() {
  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" />
      <ShadowCases />
    </SafeAreaProvider>
  );
}

function ShadowCases() {
  const safeAreaInsets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { paddingTop: safeAreaInsets.top + 32 }]}>
      {shadowCases.map(shadowCase => (
        <View key={shadowCase.label} style={styles.case}>
          <Text style={styles.code}>{shadowCase.code}</Text>
          <View
            accessible
            accessibilityLabel={shadowCase.label}
            style={[styles.box, shadowCase.style]}
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  case: {
    alignItems: 'center',
    marginBottom: 64,
  },
  code: {
    marginBottom: 12,
    fontSize: 13,
    color: '#57606a',
  },
  box: {
    width: 100,
    height: 50,
    backgroundColor: '#cbd5e1',
  },
});

export default App;
