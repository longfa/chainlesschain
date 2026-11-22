package com.chainlesschain.ide.intellij;

import com.chainlesschain.ide.LlmConfig;
import com.chainlesschain.ide.LlmConnectionPanel;
import com.chainlesschain.ide.LkChannelCatalog;
import com.intellij.openapi.actionSystem.AnAction;
import com.intellij.openapi.actionSystem.AnActionEvent;
import com.intellij.openapi.application.ApplicationManager;
import com.intellij.openapi.application.ModalityState;
import com.intellij.openapi.project.Project;
import com.intellij.openapi.ui.DialogWrapper;
import com.intellij.openapi.ui.Messages;
import org.jetbrains.annotations.NotNull;
import javax.swing.Action;
import javax.swing.JComponent;
import java.util.concurrent.Callable;

/** One native form, with atomic CLI writes and explicit readback. */
public final class ConfigureLlmAction extends AnAction {
    @Override public void actionPerformed(@NotNull AnActionEvent event) { runWizard(event.getProject()); }
    public static void runWizard(Project project) {
        ConnectionDialog dialog = new ConnectionDialog(project);
        dialog.show();
    }

    private static final class ConnectionDialog extends DialogWrapper {
        private final LlmConnectionPanel form = new LlmConnectionPanel(CcBundle::message);
        private boolean closed;
        ConnectionDialog(Project project) {
            super(project, true);
            setTitle(CcBundle.message("llm.dialogTitle"));
            setCancelButtonText(CcBundle.message("llm.form.close"));
            init();
            form.onReload(this::reload); form.onSave(this::save); form.onTest(this::test);
            form.onAccount(this::account);
            form.onRefreshLkModels(this::refreshLkModels);
            reload();
        }
        @Override protected JComponent createCenterPanel() { return form; }
        @Override protected Action @NotNull [] createActions() { return new Action[]{getCancelAction()}; }
        @Override protected String getDimensionServiceKey() { return "ChainlessChain.LlmConnection"; }
        @Override protected void dispose() { closed = true; form.clearSecret(); super.dispose(); }

        private void background(String status, Callable<Runnable> operation) {
            form.setBusy(true); form.notice(status);
            ApplicationManager.getApplication().executeOnPooledThread(() -> {
                Runnable result;
                try { result = operation.call(); }
                catch (Exception error) { result = () -> form.notice(CcBundle.message("llm.form.readFailed")); }
                final Runnable finish = result;
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (closed) return;
                    try { finish.run(); } finally { form.setBusy(false); }
                }, ModalityState.any());
            });
        }
        private void reload() {
            background(CcBundle.message("llm.form.loading"), () -> {
                LlmConfig.Connection saved = LlmConfig.readConnection();
                java.util.List<LlmConfig.Connection> profiles = LlmConfig.readSavedConnections();
                java.util.List<LkChannelCatalog.Model> models = LlmConfig.readLiveLkModels();
                return () -> { form.load(saved); form.setSavedConnections(profiles); form.setLiveLkModels(models); };
            });
        }
        private void refreshLkModels() {
            background("正在读取 LK 模型目录…", () -> {
                java.util.List<LkChannelCatalog.Model> models = LlmConfig.readLiveLkModels();
                return () -> {
                    form.setLiveLkModels(models);
                    form.notice(models.isEmpty() ? "当前使用内置 LK 模型目录" : "已刷新 LK 模型目录");
                };
            });
        }
        private void save() {
            LlmConfig.Connection submitted = form.connection();
            boolean allowHttp = form.allowHttp();
            String validation = form.validateConnection();
            if (validation != null) { form.notice(validation); return; }
            if (form.needsNewKey()) { form.notice(CcBundle.message("llm.form.newKeyRequired")); return; }
            String key = form.apiKey();
            background(CcBundle.message("llm.form.saving"), () -> {
                String error = LlmConfig.saveConnection(submitted, key, allowHttp);
                if (error != null) return () -> form.notice(CcBundle.message("llm.error.configWrite", error));
                LlmConfig.Connection confirmed = LlmConfig.readConnection();
                java.util.List<LlmConfig.Connection> profiles = LlmConfig.readSavedConnections();
                return () -> { form.load(confirmed); form.setSavedConnections(profiles); form.notice(CcBundle.message("llm.form.saved")); };
            });
        }
        private void test() {
            background(CcBundle.message("llm.form.testing"), () -> {
                LlmConfig.CliResult result = LlmConfig.testLlm();
                return () -> form.notice(CcBundle.message(result.ok ? "llm.form.testPassed" : "llm.form.testFailed", result.output));
            });
        }
        private void account() {
            background("正在读取 LK 动态价格与实际账单…", () -> {
                LlmConfig.CliResult result = LlmConfig.queryLkAccount();
                return () -> { form.showAccount(result.output); form.notice(result.ok ? "已刷新；金额单位为算力" : result.output); };
            });
        }
    }

    public static void configureVisionModel(Project project) {
        ApplicationManager.getApplication().executeOnPooledThread(() -> {
            final String current;
            try { current = LlmConfig.readConnection().visionModel; }
            catch (Exception error) {
                ApplicationManager.getApplication().invokeLater(() -> {
                    if (project == null || !project.isDisposed())
                        Messages.showErrorDialog(project, CcBundle.message("llm.form.readFailed"), CcBundle.message("llm.dialogTitle"));
                }, ModalityState.any());
                return;
            }
            ApplicationManager.getApplication().invokeLater(() -> {
                if (project != null && project.isDisposed()) return;
                String vision = Messages.showInputDialog(project, CcBundle.message("llm.prompt.vision"),
                        CcBundle.message("llm.dialogTitle"), null, current == null ? "" : current, null);
                if (vision == null) return;
                ApplicationManager.getApplication().executeOnPooledThread(() -> {
                    String error = LlmConfig.setVisionModel(vision);
                    ApplicationManager.getApplication().invokeLater(() -> {
                        if (project != null && project.isDisposed()) return;
                        if (error != null) Messages.showErrorDialog(project, CcBundle.message("llm.error.visionWrite", error), CcBundle.message("llm.dialogTitle"));
                        else Messages.showInfoMessage(project, CcBundle.message(vision.trim().isEmpty() ? "llm.info.visionCleared" : "llm.info.visionSet", vision.trim()), CcBundle.message("llm.dialogTitle"));
                    }, ModalityState.any());
                });
            }, ModalityState.any());
        });
    }
}
