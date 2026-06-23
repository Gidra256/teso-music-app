import { Component } from "react";
import { StyleSheet, Text, View } from "react-native";

import { colors, spacing } from "../theme";

export default class AppErrorBoundary extends Component {
  state = {
    error: null,
  };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.log("App startup error:", error?.message || error);
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message}>{this.state.error?.message || "The app could not finish loading."}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: colors.background,
    flex: 1,
    justifyContent: "center",
    padding: spacing.page,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
    marginBottom: 10,
    textAlign: "center",
  },
  message: {
    color: colors.softText,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
