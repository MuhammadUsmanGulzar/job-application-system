import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from 'react-native';

const getScoreTone = (score) => {
  if (score >= 80) return { strong: '#166534', soft: '#ecfdf3', border: '#86efac' };
  if (score >= 60) return { strong: '#9a6700', soft: '#fffbeb', border: '#f6d365' };
  return { strong: '#b42318', soft: '#fff1f0', border: '#fda29b' };
};

const scoreLabels = {
  skills: 'Skills',
  title: 'Role alignment',
  experience: 'Experience',
  education: 'Education',
  formatting: 'ATS format',
};

export default function AtsDashboard({
  report,
  previousScore = null,
  isOptimizing = false,
  isGenerating = false,
  onEditResume,
  onOptimizeResume,
  onGenerateEmail,
  compact = false,
}) {
  const { width } = useWindowDimensions();
  const isMobile = width < 640 || compact;
  if (!report) return null;

  const tone = getScoreTone(report.score || 0);
  const improvement = previousScore !== null ? (report.score || 0) - previousScore : null;
  const breakdown = report.scoreBreakdown || {};

  return (
    <View style={[styles.card, compact && styles.cardCompact]}>
      <View style={[styles.header, isMobile && styles.headerMobile]}>
        <View style={{ flex: 1 }}>
          <View style={styles.eyebrowRow}>
            <Text style={styles.eyebrow}>ATS MATCH REPORT</Text>
            <View style={[styles.stageBadge, report.stage === 'after' && styles.stageBadgeAfter]}>
              <Text style={[styles.stageBadgeText, report.stage === 'after' && styles.stageBadgeTextAfter]}>
                {report.stage === 'after' ? 'AFTER OPTIMIZATION' : 'CURRENT RESUME'}
              </Text>
            </View>
            {report.source ? (
              <View style={[styles.stageBadge, styles.engineBadge]}>
                <Text style={styles.engineBadgeText}>
                  {report.source.startsWith('llm-')
                    ? `AI Engine (${report.source.replace('llm-', '').toUpperCase()})`
                    : report.source === 'smart-local-ats-engine'
                      ? 'Smart Local Engine'
                      : report.source === 'langgraph-ats-agent'
                        ? 'LangGraph Agent'
                        : 'Local Engine'}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title}>Resume-to-job fit analysis</Text>
          <Text style={styles.summary}>{report.summary}</Text>
        </View>

        <View style={[styles.scoreCircle, { backgroundColor: tone.soft, borderColor: tone.border }] }>
          <Text style={[styles.scoreValue, { color: tone.strong }]}>{report.score}</Text>
          <Text style={[styles.scoreUnit, { color: tone.strong }]}>/ 100</Text>
          {improvement !== null && improvement > 0 ? (
            <Text style={styles.scoreGain}>+{improvement}</Text>
          ) : null}
        </View>
      </View>

      <View style={styles.breakdownGrid}>
        {Object.keys(scoreLabels).map((key) => (
          <View key={key} style={styles.metricCard}>
            <View style={styles.metricTopline}>
              <Text style={styles.metricLabel}>{scoreLabels[key]}</Text>
              <Text style={styles.metricValue}>{breakdown[key] ?? 0}%</Text>
            </View>
            <View style={styles.metricTrack}>
              <View style={[styles.metricFill, { width: `${Math.max(2, breakdown[key] || 0)}%` }]} />
            </View>
          </View>
        ))}
      </View>

      <View style={[styles.skillsGrid, isMobile && styles.skillsGridMobile]}>
        <View style={styles.skillColumn}>
          <Text style={styles.sectionLabel}>Matched requirements</Text>
          <View style={styles.chipRow}>
            {(report.matchedSkills || []).length ? report.matchedSkills.map((skill) => (
              <View key={`matched-${skill}`} style={[styles.chip, styles.chipMatched]}>
                <Text style={styles.chipMatchedText}>{skill}</Text>
              </View>
            )) : <Text style={styles.emptyText}>No explicit keyword matches detected yet.</Text>}
          </View>
        </View>

        <View style={styles.skillColumn}>
          <Text style={styles.sectionLabel}>Keyword gaps</Text>
          <View style={styles.chipRow}>
            {(report.missingSkills || []).length ? report.missingSkills.map((skill) => (
              <View key={`missing-${skill}`} style={[styles.chip, styles.chipMissing]}>
                <Text style={styles.chipMissingText}>{skill}</Text>
              </View>
            )) : <Text style={styles.emptyText}>No major keyword gaps detected.</Text>}
          </View>
        </View>
      </View>

      <View style={styles.suggestionsPanel}>
        <Text style={styles.sectionLabel}>Agent recommendations</Text>
        {(report.suggestions || []).map((suggestion, index) => (
          <View key={`${suggestion.title}-${index}`} style={styles.suggestionRow}>
            <View style={[styles.priorityLine, suggestion.priority === 'high' && styles.priorityLineHigh]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.suggestionTitle}>{suggestion.title}</Text>
              <Text style={styles.suggestionDetail}>{suggestion.detail}</Text>
            </View>
          </View>
        ))}
      </View>

      {(onEditResume || onOptimizeResume || onGenerateEmail) ? (
        <View style={[styles.actions, isMobile && styles.actionsMobile]}>
          {onEditResume ? (
            <TouchableOpacity style={[styles.button, styles.buttonSecondary, isMobile && styles.buttonMobile]} onPress={onEditResume}>
              <Text style={styles.buttonSecondaryText}>Edit resume myself</Text>
            </TouchableOpacity>
          ) : null}
          {onOptimizeResume ? (
            <TouchableOpacity
              style={[styles.button, styles.buttonPrimary, isMobile && styles.buttonMobile, isOptimizing && styles.buttonDisabled]}
              onPress={onOptimizeResume}
              disabled={isOptimizing}
            >
              {isOptimizing ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.buttonPrimaryText}>Optimize with agent</Text>}
            </TouchableOpacity>
          ) : null}
          {onGenerateEmail ? (
            <TouchableOpacity
              style={[styles.button, styles.buttonDark, isMobile && styles.buttonMobile, isGenerating && styles.buttonDisabled]}
              onPress={onGenerateEmail}
              disabled={isGenerating}
            >
              {isGenerating ? <ActivityIndicator size="small" color="#ffffff" /> : <Text style={styles.buttonPrimaryText}>Generate application email</Text>}
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderColor: '#dfe4e0',
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 20,
    padding: 24,
  },
  cardCompact: { marginTop: 14, padding: 16 },
  header: { alignItems: 'center', flexDirection: 'row', gap: 24, justifyContent: 'space-between' },
  headerMobile: { alignItems: 'flex-start', flexDirection: 'column-reverse', gap: 14 },
  eyebrowRow: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  eyebrow: { color: '#536159', fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  stageBadge: { backgroundColor: '#f4f6f4', borderRadius: 20, paddingHorizontal: 8, paddingVertical: 3 },
  stageBadgeAfter: { backgroundColor: '#e9f7ef' },
  stageBadgeText: { color: '#647069', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  stageBadgeTextAfter: { color: '#166534' },
  engineBadge: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  engineBadgeText: { color: '#15803d', fontSize: 9, fontWeight: '800', letterSpacing: 0.5 },
  title: { color: '#17201c', fontSize: 22, fontWeight: '700', marginBottom: 6 },
  summary: { color: '#647069', fontSize: 13, lineHeight: 20, maxWidth: 720 },
  scoreCircle: { alignItems: 'center', borderRadius: 50, borderWidth: 1, height: 96, justifyContent: 'center', minWidth: 96 },
  scoreValue: { fontSize: 30, fontWeight: '800', lineHeight: 34 },
  scoreUnit: { fontSize: 10, fontWeight: '700' },
  scoreGain: { backgroundColor: '#166534', borderRadius: 10, bottom: -7, color: '#ffffff', fontSize: 10, fontWeight: '800', paddingHorizontal: 7, paddingVertical: 2, position: 'absolute' },
  breakdownGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 22 },
  metricCard: { backgroundColor: '#f8faf8', borderColor: '#e7ebe8', borderRadius: 8, borderWidth: 1, flexGrow: 1, minWidth: 145, padding: 12 },
  metricTopline: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  metricLabel: { color: '#647069', fontSize: 11, fontWeight: '600' },
  metricValue: { color: '#253c32', fontSize: 12, fontWeight: '800' },
  metricTrack: { backgroundColor: '#e3e8e4', borderRadius: 3, height: 5, overflow: 'hidden' },
  metricFill: { backgroundColor: '#416353', borderRadius: 3, height: 5 },
  skillsGrid: { flexDirection: 'row', gap: 18, marginTop: 22 },
  skillsGridMobile: { flexDirection: 'column' },
  skillColumn: { flex: 1 },
  sectionLabel: { color: '#35403a', fontSize: 12, fontWeight: '800', letterSpacing: 0.3, marginBottom: 9, textTransform: 'uppercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderRadius: 6, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 4 },
  chipMatched: { backgroundColor: '#f0f8f3', borderColor: '#b7dec4' },
  chipMissing: { backgroundColor: '#fff8ed', borderColor: '#f2cf91' },
  chipMatchedText: { color: '#24613a', fontSize: 11, fontWeight: '600' },
  chipMissingText: { color: '#8a5300', fontSize: 11, fontWeight: '600' },
  emptyText: { color: '#8a938e', fontSize: 12 },
  suggestionsPanel: { backgroundColor: '#f8faf8', borderRadius: 9, gap: 8, marginTop: 22, padding: 14 },
  suggestionRow: { backgroundColor: '#ffffff', borderColor: '#e7ebe8', borderRadius: 7, borderWidth: 1, flexDirection: 'row', overflow: 'hidden' },
  priorityLine: { backgroundColor: '#d2a540', width: 3 },
  priorityLineHigh: { backgroundColor: '#c95d50' },
  suggestionTitle: { color: '#25302b', fontSize: 13, fontWeight: '700', paddingHorizontal: 11, paddingTop: 9 },
  suggestionDetail: { color: '#6d7671', fontSize: 12, lineHeight: 18, paddingBottom: 10, paddingHorizontal: 11, paddingTop: 3 },
  actions: { borderTopColor: '#edf0ed', borderTopWidth: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 9, justifyContent: 'flex-end', marginTop: 20, paddingTop: 16 },
  actionsMobile: { alignItems: 'stretch', flexDirection: 'column' },
  button: { alignItems: 'center', borderRadius: 7, justifyContent: 'center', minHeight: 40, paddingHorizontal: 16, paddingVertical: 10 },
  buttonMobile: { width: '100%' },
  buttonSecondary: { backgroundColor: '#ffffff', borderColor: '#ccd3ce', borderWidth: 1 },
  buttonPrimary: { backgroundColor: '#2f6049' },
  buttonDark: { backgroundColor: '#17201c' },
  buttonDisabled: { opacity: 0.58 },
  buttonSecondaryText: { color: '#35403a', fontSize: 13, fontWeight: '700' },
  buttonPrimaryText: { color: '#ffffff', fontSize: 13, fontWeight: '700' },
});
