import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  TouchableWithoutFeedback,
} from 'react-native';

const TYPE_CONFIG = {
  success: {
    icon: '✓',
    iconBg: '#dcfce7',
    iconBorder: '#86efac',
    iconColor: '#166534',
    btnBg: '#166534',
    defaultTitle: 'Success',
  },
  error: {
    icon: '✕',
    iconBg: '#fee2e2',
    iconBorder: '#fca5a5',
    iconColor: '#dc2626',
    btnBg: '#dc2626',
    defaultTitle: 'Notice',
  },
  warning: {
    icon: '!',
    iconBg: '#fef3c7',
    iconBorder: '#fde68a',
    iconColor: '#b45309',
    btnBg: '#b45309',
    defaultTitle: 'Warning',
  },
  confirm: {
    icon: '?',
    iconBg: '#fee2e2',
    iconBorder: '#fca5a5',
    iconColor: '#dc2626',
    btnBg: '#dc2626',
    defaultTitle: 'Are you sure?',
  },
  info: {
    icon: 'ℹ',
    iconBg: '#e0f2fe',
    iconBorder: '#bae6fd',
    iconColor: '#0284c7',
    btnBg: '#0f172a',
    defaultTitle: 'Notice',
  },
};

export default function CustomAlertModal({
  visible = false,
  title,
  message,
  type = 'info',
  confirmText,
  cancelText = 'Cancel',
  onConfirm,
  onCancel,
  onClose,
}) {
  if (!visible) return null;

  const config = TYPE_CONFIG[type] || TYPE_CONFIG.info;
  const isConfirm = type === 'confirm' || typeof onCancel === 'function';
  const displayTitle = title || config.defaultTitle;
  const displayConfirmText = confirmText || (isConfirm ? 'Confirm' : 'Got it');

  const handleClose = () => {
    if (onClose) onClose();
    else if (onCancel) onCancel();
  };

  const handleConfirm = () => {
    if (onConfirm) onConfirm();
    if (onClose) onClose();
  };

  return (
    <Modal
      transparent
      animationType="fade"
      visible={visible}
      onRequestClose={handleClose}
    >
      <TouchableWithoutFeedback onPress={handleClose}>
        <View style={styles.overlay}>
          <TouchableWithoutFeedback>
            <View style={styles.card}>
              {/* Type Badge Icon */}
              <View
                style={[
                  styles.iconCircle,
                  {
                    backgroundColor: config.iconBg,
                    borderColor: config.iconBorder,
                  },
                ]}
              >
                <Text style={[styles.iconText, { color: config.iconColor }]}>
                  {config.icon}
                </Text>
              </View>

              {/* Title & Message */}
              <Text style={styles.title}>{displayTitle}</Text>
              <Text style={styles.message}>{message}</Text>

              {/* Action Buttons */}
              {isConfirm ? (
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.btn, styles.cancelBtn]}
                    onPress={handleClose}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.cancelBtnText}>{cancelText}</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.btn, { backgroundColor: config.btnBg }]}
                    onPress={handleConfirm}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.confirmBtnText}>{displayConfirmText}</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.btn, styles.singleBtn, { backgroundColor: config.btnBg }]}
                  onPress={handleConfirm}
                  activeOpacity={0.8}
                >
                  <Text style={styles.confirmBtnText}>{displayConfirmText}</Text>
                </TouchableOpacity>
              )}
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    zIndex: 99999,
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 420,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 10,
    alignItems: 'center',
  },
  iconCircle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
  },
  iconText: {
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 24,
    textAlign: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  singleBtn: {
    width: '100%',
  },
  cancelBtn: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  cancelBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#475569',
  },
  confirmBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#ffffff',
  },
});
