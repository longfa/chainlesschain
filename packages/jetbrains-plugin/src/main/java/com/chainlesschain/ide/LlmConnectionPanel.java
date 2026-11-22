package com.chainlesschain.ide;

import java.awt.BorderLayout;
import java.awt.GridBagConstraints;
import java.awt.GridBagLayout;
import java.awt.Insets;
import java.net.URI;
import java.util.Arrays;
import java.util.List;
import java.util.function.Function;
import javax.swing.*;
import javax.swing.event.DocumentEvent;
import javax.swing.event.DocumentListener;

/** Native, headless-testable connection form. Saved credentials never enter it. */
public final class LlmConnectionPanel extends JPanel {
    private static final int LK_INDEX = 0;
    private static final int PRESET_OFFSET = 1;

    private static boolean presetBaseMatches(String presetBaseUrl, String savedBaseUrl) {
        String preset = LlmConfig.normalizedBaseUrl(presetBaseUrl);
        String saved = LlmConfig.normalizedBaseUrl(savedBaseUrl);
        if (preset.equals(saved)) return true;
        try {
            URI left = URI.create(preset);
            URI right = URI.create(saved);
            if (!left.getScheme().equalsIgnoreCase(right.getScheme())
                    || left.getPort() != right.getPort()
                    || !left.getPath().equals(right.getPath())) return false;
            return isLoopback(left.getHost()) && isLoopback(right.getHost());
        } catch (RuntimeException ignored) {
            return false;
        }
    }

    private static boolean isLoopback(String host) {
        if (host == null) return false;
        return "localhost".equalsIgnoreCase(host)
                || "127.0.0.1".equals(host)
                || "::1".equals(host)
                || "0:0:0:0:0:0:0:1".equals(host);
    }
    private final Function<String, String> text;
    private final JComboBox<String> provider = new JComboBox<>();
    private final JComboBox<String> protocol = new JComboBox<>(new String[]{
            "OpenAI / Chat Completions", "Anthropic / Messages", "Gemini / Generate Content", "Ollama"});
    private final String[] protocols = {"openai", "anthropic", "gemini", "ollama"};
    private final JTextField baseUrl = new JTextField(42), model = new JTextField(42), vision = new JTextField(42);
    private final JPasswordField key = new JPasswordField(42);
    private final JCheckBox allowHttp = new JCheckBox();
    private final JLabel keyHint = new JLabel(), status = new JLabel(), protocolLabel = new JLabel();
    private final JButton save = new JButton(), test = new JButton(), reload = new JButton();
    private final JButton account = new JButton("刷新价格与余额");
    private final JButton refreshLkModels = new JButton("刷新模型");
    private final JTextArea accountResult = new JTextArea(9, 65);
    private final JComboBox<String> lkAddress = new JComboBox<>(new String[]{"api.vv666.ai", "api.lk666.ai"});
    private final JComboBox<LkChannelCatalog.Model> lkModel = new JComboBox<>();
    private final JLabel lkAddressLabel = new JLabel("LK 主备地址"), lkModelLabel = new JLabel("LK 模型目录");
    private List<LkChannelCatalog.Model> lkModels = Arrays.asList(LkChannelCatalog.MODELS);
    private LlmConfig.Connection current;
    private java.util.List<LlmConfig.Connection> savedConnections = java.util.Collections.emptyList();
    private final JComboBox<String> savedConnection = new JComboBox<>();
    private boolean busy, dirty, filling;

    public LlmConnectionPanel(Function<String, String> text) {
        super(new BorderLayout(0, 16));
        this.text = text;
        setBorder(BorderFactory.createEmptyBorder(12, 12, 12, 12));
        JLabel introduction = new JLabel(text.apply("llm.form.intro"));
        add(introduction, BorderLayout.NORTH);
        JPanel fields = new JPanel(new GridBagLayout());
        provider.addItem("LK API 聚合平台");
        for (LlmConfig.Preset preset : LlmConfig.PRESETS) provider.addItem(preset.label);
        row(fields, 0, new JLabel(text.apply("llm.form.provider")), provider);
        protocolLabel.setText(text.apply("llm.form.protocol"));
        row(fields, 1, protocolLabel, protocol);
        row(fields, 2, new JLabel(text.apply("llm.form.baseUrl")), baseUrl);
        row(fields, 3, new JLabel(text.apply("llm.form.model")), model);
        row(fields, 4, new JLabel(text.apply("llm.form.vision")), vision);
        row(fields, 5, new JLabel("API Key"), key);
        row(fields, 6, new JLabel(), keyHint);
        allowHttp.setText(text.apply("llm.form.allowHttp"));
        row(fields, 7, new JLabel(), allowHttp);
        row(fields, 8, lkAddressLabel, lkAddress);
        row(fields, 9, lkModelLabel, lkModel);
        row(fields, 10, new JLabel("已保存渠道 · 自动恢复凭证"), savedConnection);
        savedConnection.setName("llm.savedConnection");
        savedConnection.addActionListener(e -> {
            if (filling || savedConnection.getSelectedIndex() <= 0) return;
            LlmConfig.Connection active = current;
            load(savedConnections.get(savedConnection.getSelectedIndex() - 1));
            current = active; dirty = true; update();
        });
        lkModel.setPrototypeDisplayValue(new LkChannelCatalog.Model("gpt-6.1-sol", "GPT-6.1 sol", "chat", "openai"));
        lkModel.setToolTipText("内置离线目录");
        JPanel body = new JPanel(new BorderLayout());
        body.add(fields, BorderLayout.NORTH);
        accountResult.setEditable(false); accountResult.setLineWrap(true); accountResult.setWrapStyleWord(true);
        accountResult.setName("llm.accountResult");
        body.add(new JScrollPane(accountResult), BorderLayout.CENTER);
        add(body, BorderLayout.CENTER);
        JPanel footer = new JPanel(new BorderLayout(0, 12));
        status.setText(text.apply("llm.form.loading"));
        status.setName("llm.connection.status");
        footer.add(status, BorderLayout.NORTH);
        JPanel buttons = new JPanel(new java.awt.FlowLayout(java.awt.FlowLayout.RIGHT, 8, 0));
        reload.setText(text.apply("llm.form.reload"));
        save.setText(text.apply("llm.form.save"));
        test.setText(text.apply("llm.form.test"));
        buttons.add(reload); buttons.add(save); buttons.add(test); buttons.add(account); buttons.add(refreshLkModels);
        refreshLkModels.setName("llm.lkModelRefresh");
        account.setName("llm.account");
        account.setToolTipText("查询已保存 LK 连接：最近 1 天当前 Key API 实扣、动态价格及账户余额；更多范围：cc llm account --help");
        footer.add(buttons, BorderLayout.SOUTH);
        add(footer, BorderLayout.SOUTH);
        provider.setName("llm.provider"); protocol.setName("llm.protocol"); baseUrl.setName("llm.baseUrl");
        model.setName("llm.model"); vision.setName("llm.visionModel"); key.setName("llm.apiKey");
        lkAddress.setName("llm.lkAddress"); lkModel.setName("llm.lkModel");
        save.setName("llm.save"); test.setName("llm.test"); reload.setName("llm.reload");
        DocumentListener changed = new DocumentListener() {
            public void insertUpdate(DocumentEvent e) { changed(); }
            public void removeUpdate(DocumentEvent e) { changed(); }
            public void changedUpdate(DocumentEvent e) { changed(); }
        };
        for (JTextField field : new JTextField[]{baseUrl, model, vision, key}) field.getDocument().addDocumentListener(changed);
        provider.addActionListener(e -> {
            if (filling) return;
            filling = true;
            int index = provider.getSelectedIndex();
            int presetIndex = index - PRESET_OFFSET;
            if (presetIndex >= 0 && presetIndex < LlmConfig.PRESETS.length) {
                LlmConfig.Preset preset = LlmConfig.PRESETS[presetIndex];
                baseUrl.setText(preset.baseUrl); model.setText(preset.defaultModel);
                vision.setText(LlmConfig.suggestVisionModel(preset.id));
            } else if (isLk()) {
                protocol.setSelectedIndex(0); lkAddress.setSelectedIndex(0);
                applyLk(false);
            }
            key.setText(""); allowHttp.setSelected(false);
            filling = false;
            changed();
        });
        protocol.addActionListener(e -> {
            if (!filling) {
                if (isLk()) {
                    filling = true;
                    if (protocol.getSelectedIndex() == 3) protocol.setSelectedIndex(0);
                    applyLk(false); filling = false;
                }
                key.setText(""); changed();
            }
        });
        lkAddress.addActionListener(e -> {
            if (!filling) { filling = true; applyLk(true); filling = false; changed(); }
        });
        lkModel.addActionListener(e -> {
            if (!filling && lkModel.getSelectedItem() instanceof LkChannelCatalog.Model selected) {
                model.setText(selected.id);
            }
        });
        allowHttp.addActionListener(e -> changed());
        filling = true;
        applyLk(false);
        filling = false;
        update();
    }

    private static void row(JPanel panel, int row, JLabel label, JComponent input) {
        GridBagConstraints constraints = new GridBagConstraints();
        constraints.gridy = row; constraints.gridx = 0; constraints.anchor = GridBagConstraints.WEST;
        constraints.insets = new Insets(6, 0, 6, 16);
        label.setLabelFor(input); panel.add(label, constraints);
        constraints.gridx = 1; constraints.weightx = 1; constraints.fill = GridBagConstraints.HORIZONTAL;
        constraints.insets = new Insets(6, 0, 6, 0);
        panel.add(input, constraints);
    }

    private String selectedPresetId() {
        int presetIndex = provider.getSelectedIndex() - PRESET_OFFSET;
        return presetIndex >= 0 && presetIndex < LlmConfig.PRESETS.length
                ? LlmConfig.PRESETS[presetIndex].id : null;
    }

    private String providerId() {
        if (isLk()) return protocol.getSelectedIndex() == 0 ? "custom" : protocols[protocol.getSelectedIndex()];
        String presetId = selectedPresetId();
        if ("custom".equals(presetId) && protocol.getSelectedIndex() != 0) {
            return protocols[protocol.getSelectedIndex()];
        }
        return presetId == null ? protocols[protocol.getSelectedIndex()] : presetId;
    }

    private boolean isLk() { return provider.getSelectedIndex() == LK_INDEX; }

    private void fillLkModels(String selected) {
        lkModel.removeAllItems();
        String wire = protocols[protocol.getSelectedIndex()];
        for (LkChannelCatalog.Model entry : lkModels) {
            if ("chat".equals(entry.type) && wire.equals(entry.protocol)) {
                lkModel.addItem(entry);
            }
        }
        lkModel.setSelectedIndex(-1);
        for (int i = 0; i < lkModel.getItemCount(); i++)
            if (lkModel.getItemAt(i).id.equals(selected)) {
                lkModel.setSelectedIndex(i);
                break;
            }
    }

    public void setLiveLkModels(List<LkChannelCatalog.Model> models) {
        lkModels = models.isEmpty() ? Arrays.asList(LkChannelCatalog.MODELS) : models;
        lkModel.setToolTipText(models.isEmpty() ? "内置离线目录" : "平台最新目录");
        if (!isLk()) return;
        filling = true;
        try { fillLkModels(model.getText()); }
        finally { filling = false; }
    }

    public String validateConnection() {
        return LlmConfig.validateConnection(connection(), allowHttp(), lkModels);
    }

    private void applyLk(boolean keepModel) {
        String previous = model.getText();
        String wire = protocols[protocol.getSelectedIndex()];
        String defaultModel = "anthropic".equals(wire) ? "claude-opus-5-5" : "gemini".equals(wire) ? "gemini-4-carbon" : "gpt-6.1-sol";
        fillLkModels(keepModel ? previous : defaultModel);
        if (!keepModel && lkModel.getSelectedIndex() < 0 && lkModel.getItemCount() > 0) {
            lkModel.setSelectedIndex(0);
            defaultModel = lkModel.getItemAt(0).id;
        }
        baseUrl.setText(LkChannelCatalog.baseUrl(wire, lkAddress.getSelectedIndex() == 1));
        model.setText(keepModel ? previous : defaultModel);
        vision.setText(""); key.setText(""); allowHttp.setSelected(false);
    }

    private void changed() {
        if (filling) return;
        dirty = true;
        status.setText(text.apply("llm.form.unsaved"));
        update();
    }

    private void update() {
        boolean custom = "custom".equals(selectedPresetId()) && !isLk()
                && baseUrl.getText().trim().isEmpty();
        protocol.setVisible(custom || isLk()); protocolLabel.setVisible(custom || isLk());
        lkAddress.setVisible(isLk()); lkAddressLabel.setVisible(isLk());
        lkModel.setVisible(isLk()); lkModelLabel.setVisible(isLk());
        refreshLkModels.setVisible(isLk());
        refreshLkModels.setEnabled(!busy);
        boolean same = current != null && providerId().equals(current.provider)
                && LlmConfig.normalizedBaseUrl(baseUrl.getText()).equals(LlmConfig.normalizedBaseUrl(current.baseUrl));
        keyHint.setText(text.apply("ollama".equals(providerId()) ? "llm.form.keyless"
                : "custom".equals(providerId()) && !LkChannelCatalog.isEndpoint(baseUrl.getText()) && !(same && current.hasKey) ? "llm.form.optionalLocalKey"
                : same && current.hasKey ? "llm.form.keepKey" : "llm.form.newKey"));
        if (hasSavedKey()) keyHint.setText("此渠道凭证已保存，留空自动恢复");
        boolean remoteHttp = false;
        try {
            java.net.URI uri = new java.net.URI(baseUrl.getText().trim());
            String host = uri.getHost();
            remoteHttp = "http".equalsIgnoreCase(uri.getScheme()) && host != null
                    && !"localhost".equalsIgnoreCase(host) && !"127.0.0.1".equals(host) && !"[::1]".equals(host);
        } catch (Exception ignored) { }
        allowHttp.setVisible(remoteHttp);
        for (JComponent field : new JComponent[]{provider, protocol, baseUrl, model, vision, allowHttp}) field.setEnabled(!busy);
        lkAddress.setEnabled(!busy); lkModel.setEnabled(!busy);
        key.setEnabled(!busy && !"ollama".equals(providerId()));
        save.setEnabled(!busy && current != null && dirty);
        test.setEnabled(!busy && current != null && !dirty && !current.model.isEmpty());
        reload.setEnabled(!busy);
        account.setEnabled(!busy && !dirty && current != null && current.hasKey && LkChannelCatalog.isEndpoint(current.baseUrl));
        if (dirty) accountResult.setText("");
        revalidate();
    }

    public void load(LlmConfig.Connection value) {
        accountResult.setText("");
        filling = true;
        current = value;
        int index = PRESET_OFFSET;
        for (int i = 0; i < LlmConfig.PRESETS.length; i++) {
            LlmConfig.Preset preset = LlmConfig.PRESETS[i];
            // Provider-specific IDs retain credential and pricing identity on relays.
            if (preset.id.equals(value.provider) && (!Arrays.asList(protocols).contains(value.provider)
                    || presetBaseMatches(preset.baseUrl, value.baseUrl))) index = i + PRESET_OFFSET;
        }
        boolean lk = LkChannelCatalog.isEndpoint(value.baseUrl)
                && Arrays.asList("custom", "openai", "anthropic", "gemini").contains(value.provider);
        if (lk) index = LK_INDEX;
        provider.setSelectedIndex(index);
        if (lk && "custom".equals(value.provider)) protocol.setSelectedIndex(0);
        for (int i = 0; i < protocols.length; i++) if (protocols[i].equals(value.provider)) protocol.setSelectedIndex(i);
        if (lk) {
            lkAddress.setSelectedIndex(value.baseUrl.startsWith(LkChannelCatalog.BACKUP + "/") ? 1 : 0);
            fillLkModels(value.model);
        }
        baseUrl.setText(value.baseUrl); model.setText(value.model); vision.setText(value.visionModel);
        key.setText(""); allowHttp.setSelected(false);
        dirty = false; filling = false;
        status.setText(text.apply("llm.form.loaded"));
        update();
    }

    public LlmConfig.Connection connection() {
        String id = providerId();
        // Keep a saved provider identity while its relay URL is being displayed;
        // the custom row prevents recommendations from overwriting that URL.
        if (!dirty && current != null && "custom".equals(id) && !"custom".equals(current.provider)) id = current.provider;
        return new LlmConfig.Connection(id, model.getText().trim(), baseUrl.getText().trim(), vision.getText().trim(), false);
    }
    public String apiKey() { char[] value = key.getPassword(); try { return new String(value).trim(); } finally { Arrays.fill(value, '\0'); } }
    public boolean allowHttp() { return allowHttp.isSelected(); }
    public boolean needsNewKey() {
        String activeProvider = !dirty && current != null ? connection().provider : providerId();
        boolean customRemote = "custom".equals(activeProvider)
                && baseUrl.getText().trim().toLowerCase(java.util.Locale.ROOT).startsWith("https://");
        return (LkChannelCatalog.isEndpoint(baseUrl.getText()) || LlmConfig.requiresApiKey(activeProvider) || customRemote)
                && apiKey().isEmpty() && !hasSavedKey()
                && !(current != null && current.hasKey && activeProvider.equals(current.provider)
                && LlmConfig.normalizedBaseUrl(baseUrl.getText()).equals(LlmConfig.normalizedBaseUrl(current.baseUrl)));
    }
    public void setBusy(boolean value) { busy = value; update(); }
    private boolean hasSavedKey() {
        return savedConnections.stream().anyMatch(row -> row.hasKey && (
                (LkChannelCatalog.isEndpoint(row.baseUrl) && LkChannelCatalog.isEndpoint(baseUrl.getText())) ||
                (row.provider.equals(providerId()) && LlmConfig.normalizedBaseUrl(row.baseUrl).equals(LlmConfig.normalizedBaseUrl(baseUrl.getText())))));
    }
    public void setSavedConnections(java.util.List<LlmConfig.Connection> values) {
        filling = true; savedConnections = values; savedConnection.removeAllItems(); savedConnection.addItem("选择已保存渠道");
        for (LlmConfig.Connection row : values) savedConnection.addItem(row.provider + " · " + row.baseUrl + " · " + row.model);
        filling = false; update();
    }
    public void notice(String value) {
        String bounded = value == null ? "" : value.substring(0, Math.min(700, value.length()));
        status.setText("<html><div style='width:580px'>" + bounded.replace("&", "&amp;")
                .replace("<", "&lt;").replace(">", "&gt;").replace("\n", "<br>") + "</div></html>");
        status.getAccessibleContext().setAccessibleDescription(bounded);
    }
    public void onSave(Runnable action) { save.addActionListener(e -> action.run()); }
    public void onTest(Runnable action) { test.addActionListener(e -> action.run()); }
    public void onReload(Runnable action) { reload.addActionListener(e -> action.run()); }
    public void onAccount(Runnable action) { account.addActionListener(e -> action.run()); }
    public void onRefreshLkModels(Runnable action) { refreshLkModels.addActionListener(e -> action.run()); }
    public void showAccount(String value) { accountResult.setText(value == null ? "" : value); accountResult.setCaretPosition(0); }
    public void clearSecret() { filling = true; key.setText(""); filling = false; }
}
