// The contract between the frontend and a backend implementation (real Tauri or in-memory mock).
// Types under ./generated are exported from Rust by ts-rs; never edit them by hand.

import type { AppInfo } from './generated/AppInfo';
import type { DirEntry } from './generated/DirEntry';
import type { DirListing } from './generated/DirListing';
import type { ErrorCode } from './generated/ErrorCode';
import type { FileContent } from './generated/FileContent';
import type { FileEntry } from './generated/FileEntry';
import type { FsChangesEvent } from './generated/FsChangesEvent';
import type { Backlinks } from './generated/Backlinks';
import type { BrokenLinksReport } from './generated/BrokenLinksReport';
import type { DocLinks } from './generated/DocLinks';
import type { SymbolSearchResult } from './generated/SymbolSearchResult';
import type { SearchResultsEvent } from './generated/SearchResultsEvent';
import type { TextSearchRequest } from './generated/TextSearchRequest';
import type { GraphChangedEvent } from './generated/GraphChangedEvent';
import type { GraphProgressEvent } from './generated/GraphProgressEvent';
import type { GraphReadyEvent } from './generated/GraphReadyEvent';
import type { GraphStatus } from './generated/GraphStatus';
import type { IndexErrorEvent } from './generated/IndexErrorEvent';
import type { IndexProgressEvent } from './generated/IndexProgressEvent';
import type { IndexReadyEvent } from './generated/IndexReadyEvent';
import type { RecentFolder } from './generated/RecentFolder';
import type { RecentFilesListing } from './generated/RecentFilesListing';
import type { RecoveredEvent } from './generated/RecoveredEvent';
import type { RescanRequest } from './generated/RescanRequest';
import type { RootInfo } from './generated/RootInfo';
import type { Session } from './generated/Session';
import type { Settings } from './generated/Settings';
import type { SettingsPatch } from './generated/SettingsPatch';
import type { TextFileContent } from './generated/TextFileContent';
import type { WatchStatusEvent } from './generated/WatchStatusEvent';
import type { AiCapabilities } from './generated/AiCapabilities';
import type { AiEventEnvelope } from './generated/AiEventEnvelope';
import type { AiProviderStatus } from './generated/AiProviderStatus';
import type { AiProviderInfo } from './generated/AiProviderInfo';
import type { Conversation } from './generated/Conversation';
import type { ConversationSummary } from './generated/ConversationSummary';
import type { AiRequest } from './generated/AiRequest';
import type { AiContextDocument } from './generated/AiContextDocument';
import type { AiEstimateInput } from './generated/AiEstimateInput';
import type { AiSizeEstimate } from './generated/AiSizeEstimate';
import type { AiStartRequest } from './generated/AiStartRequest';
import type { AiUserAction } from './generated/AiUserAction';
import type { PermissionDecision } from './generated/PermissionDecision';
import type { ProfileCorrections } from './generated/ProfileCorrections';
import type { ProjectProfile } from './generated/ProjectProfile';
import type { Subject } from './generated/Subject';
import type { QuizRecord } from './generated/QuizRecord';
import type { QuizSummary } from './generated/QuizSummary';
import type { QuizSaveKind } from './generated/QuizSaveKind';
import type { SavedQuizFile } from './generated/SavedQuizFile';
import type { QuizFileSummary } from './generated/QuizFileSummary';
import type { QuizFileText } from './generated/QuizFileText';
import type { TutorialSubjects } from './generated/TutorialSubjects';
import type { TutorialSubject } from './generated/TutorialSubject';
import type { TutorialSummary } from './generated/TutorialSummary';
import type { Tutorial } from './generated/Tutorial';
import type { TutorialRef } from './generated/TutorialRef';
import type { StoredTutorial } from './generated/StoredTutorial';
import type { WritePlan } from './generated/WritePlan';
import type { FreshnessReport } from './generated/FreshnessReport';
import type { StepQuestion } from './generated/StepQuestion';
import type { WriteTarget } from './generated/WriteTarget';
import type { WrittenTutorial } from './generated/WrittenTutorial';
import type { TutorialProgress } from './generated/TutorialProgress';

export type {
  AppInfo,
  DirEntry,
  DirListing,
  ErrorCode,
  FileContent,
  FileEntry,
  FsChangesEvent,
  GraphChangedEvent,
  GraphProgressEvent,
  GraphReadyEvent,
  GraphStatus,
  IndexErrorEvent,
  IndexProgressEvent,
  IndexReadyEvent,
  RecentFilesListing,
  RecentFolder,
  RecoveredEvent,
  RescanRequest,
  RootInfo,
  Session,
  Settings,
  SettingsPatch,
  TextFileContent,
  WatchStatusEvent,
};
export type { RenamedPath } from './generated/RenamedPath';
export type { WatchMode } from './generated/WatchMode';
export type { Theme } from './generated/Theme';
export type { ReadingWidth } from './generated/ReadingWidth';
export type { WindowFrame } from './generated/WindowFrame';
export type { AiSettings } from './generated/AiSettings';
export type { AiSettingsPatch } from './generated/AiSettingsPatch';
export type { AiPermissionSettings } from './generated/AiPermissionSettings';
export type { AiPermissionSettingsPatch } from './generated/AiPermissionSettingsPatch';
export type { PermissionRule } from './generated/PermissionRule';
export type { ConfirmFrom } from './generated/ConfirmFrom';
export type { SessionTab } from './generated/SessionTab';
export type { SessionTabKind } from './generated/SessionTabKind';
export type { AiPanelState } from './generated/AiPanelState';
export type { PanelRect } from './generated/PanelRect';
export type { SidebarView } from './generated/SidebarView';
export type { LinkInfo } from './generated/LinkInfo';
export type { SymbolHit } from './generated/SymbolHit';
export type { FileMatches } from './generated/FileMatches';
export type { SearchResultsEvent } from './generated/SearchResultsEvent';
export type { SearchStats } from './generated/SearchStats';
export type { TextMatch } from './generated/TextMatch';
export type { TextSearchRequest } from './generated/TextSearchRequest';
export type { SymbolSearchResult } from './generated/SymbolSearchResult';
export type { DocLinks } from './generated/DocLinks';
export type { Backlink } from './generated/Backlink';
export type { Backlinks } from './generated/Backlinks';
export type { BrokenDoc } from './generated/BrokenDoc';
export type { BrokenLinksReport } from './generated/BrokenLinksReport';
export type { LinkStatus } from './generated/LinkStatus';
export type { LinkTarget } from './generated/LinkTarget';
export type { RightPanelState } from './generated/RightPanelState';
export type { JsonValue } from './generated/serde_json/JsonValue';
export type { AiEvent } from './generated/AiEvent';
export type { AiImage } from './generated/AiImage';
export type { AiModel } from './generated/AiModel';
export type { AiOutcome } from './generated/AiOutcome';
export type { AiPermissionKind } from './generated/AiPermissionKind';
export type { AiPolicy } from './generated/AiPolicy';
export type { AiCapture } from './generated/AiCapture';
export type { AiContextRole } from './generated/AiContextRole';
export type { AiSizeBucket } from './generated/AiSizeBucket';
export type { AiInlinedDocument } from './generated/AiInlinedDocument';
export type { EditHunk } from './generated/EditHunk';
export type { ProposedEdit } from './generated/ProposedEdit';
export type { ConversationUsage } from './generated/ConversationUsage';
export type { Confidence } from './generated/Confidence';
export type { Detected } from './generated/Detected';
export type { DocsFacts } from './generated/DocsFacts';
export type { LanguageShare } from './generated/LanguageShare';
export type { Module } from './generated/Module';
export type { ProfileCorrections } from './generated/ProfileCorrections';
export type { ProjectKind } from './generated/ProjectKind';
export type { ProjectProfile } from './generated/ProjectProfile';
export type { Material } from './generated/Material';
export type { SourceScope } from './generated/SourceScope';
export type { Subject } from './generated/Subject';
export type { SubjectGroup } from './generated/SubjectGroup';
export type { QuizCategory } from './generated/QuizCategory';
export type { RoleFamily } from './generated/RoleFamily';
export type { QuestionKind } from './generated/QuestionKind';
export type { QuizExclusion } from './generated/QuizExclusion';
export type { QuizGenerationInput } from './generated/QuizGenerationInput';
export type { QuizMode } from './generated/QuizMode';
export type { QuizQuestion } from './generated/QuizQuestion';
export type { QuizResult } from './generated/QuizResult';
export type { QuizRound } from './generated/QuizRound';
export type { QuizSource } from './generated/QuizSource';
export type { QuizSourceKind } from './generated/QuizSourceKind';
export type { QuizAnswer } from './generated/QuizAnswer';
export type { QuizOrigin } from './generated/QuizOrigin';
export type { QuizRecord } from './generated/QuizRecord';
export type { QuizSummary } from './generated/QuizSummary';
export type { QuizSaveKind } from './generated/QuizSaveKind';
export type { SavedQuizFile } from './generated/SavedQuizFile';
export type { QuizFileSummary } from './generated/QuizFileSummary';
export type { QuizFileText } from './generated/QuizFileText';
export type { LearningSettings } from './generated/LearningSettings';
export type { LearningSettingsPatch } from './generated/LearningSettingsPatch';
export type { QuizScopeSetting } from './generated/QuizScopeSetting';
export type { Familiarity } from './generated/Familiarity';
export type { Length } from './generated/Length';
export type { TutorialInput } from './generated/TutorialInput';
export type { TutorialRef } from './generated/TutorialRef';
export type { TutorialRequest } from './generated/TutorialRequest';
export type { Tutorial } from './generated/Tutorial';
export type { Chapter } from './generated/Chapter';
export type { Step } from './generated/Step';
export type { Citation } from './generated/Citation';
export type { SelfCheck } from './generated/SelfCheck';
export type { SourceHash } from './generated/SourceHash';
export type { Verification } from './generated/Verification';
export type { ExplainStep } from './generated/ExplainStep';
export type { ConceptBridgeStep } from './generated/ConceptBridgeStep';
export type { CodeTourStep } from './generated/CodeTourStep';
export type { TourStop } from './generated/TourStop';
export type { DiagramStep } from './generated/DiagramStep';
export type { PutInOrderStep } from './generated/PutInOrderStep';
export type { MatchStep } from './generated/MatchStep';
export type { MatchPair } from './generated/MatchPair';
export type { SpotItStep } from './generated/SpotItStep';
export type { QuickCheckStep } from './generated/QuickCheckStep';
export type { TryItStep } from './generated/TryItStep';
export type { RecapStep } from './generated/RecapStep';
export type { OutlineResult } from './generated/OutlineResult';
export type { ChapterResult } from './generated/ChapterResult';
export type { FamilyKind } from './generated/FamilyKind';
export type { SubjectPick } from './generated/SubjectPick';
export type { TutorialSubject } from './generated/TutorialSubject';
export type { TutorialSubjects } from './generated/TutorialSubjects';
export type { TutorialSummary } from './generated/TutorialSummary';
export type { ProgressSummary } from './generated/ProgressSummary';
export type { StoredTutorial } from './generated/StoredTutorial';
export type { PlannedFile } from './generated/PlannedFile';
export type { PlannedState } from './generated/PlannedState';
export type { WritePlan } from './generated/WritePlan';
export type { Badge } from './generated/Badge';
export type { FreshnessReport } from './generated/FreshnessReport';
export type { SourceCheck } from './generated/SourceCheck';
export type { SourceState } from './generated/SourceState';
export type { StepRef } from './generated/StepRef';
export type { StepQuestion } from './generated/StepQuestion';
export type { TutorialStepContext } from './generated/TutorialStepContext';
export type { ChapterReview } from './generated/ChapterReview';
export type { ChapterVerdict } from './generated/ChapterVerdict';
export type { MissingTopic } from './generated/MissingTopic';
export type { StepProposal } from './generated/StepProposal';
export type { TutorialReview } from './generated/TutorialReview';
export type { WriteTarget } from './generated/WriteTarget';
export type { WrittenTutorial } from './generated/WrittenTutorial';
export type { TutorialProgress } from './generated/TutorialProgress';
export type { StepAnswer } from './generated/StepAnswer';
export type { TutorialUsage } from './generated/TutorialUsage';
export type { SuggestResult } from './generated/SuggestResult';
export type {
  AiCapabilities,
  AiEventEnvelope,
  AiProviderInfo,
  AiProviderStatus,
  AiContextDocument,
  AiEstimateInput,
  AiRequest,
  AiSizeEstimate,
  AiStartRequest,
  AiUserAction,
  Conversation,
  ConversationSummary,
  PermissionDecision,
};

export interface SymbolSearchRequest {
  query: string;
  limit?: number;
  headingsOnly?: boolean;
  /** Recently opened files, most recent first (ranked higher, listed for an empty query). */
  recent: string[];
  requestId: number;
}

/** Error raised by any backend call. */
export class BackendError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'BackendError';
    this.code = code;
  }
}

/** Events pushed by the backend, keyed by event name. */
export interface BackendEvents {
  'appdata://recovered': RecoveredEvent;
  'index://progress': IndexProgressEvent;
  'index://ready': IndexReadyEvent;
  'index://error': IndexErrorEvent;
  'fs://changes': FsChangesEvent;
  'fs://watch-status': WatchStatusEvent;
  'graph://progress': GraphProgressEvent;
  'graph://ready': GraphReadyEvent;
  'graph://changed': GraphChangedEvent;
  'search://results': SearchResultsEvent;
  'ai://event': AiEventEnvelope;
}

export type EventName = keyof BackendEvents;
export type Unsubscribe = () => void;

export type ResizeDirection =
  'North' | 'South' | 'East' | 'West' | 'NorthEast' | 'NorthWest' | 'SouthEast' | 'SouthWest';

/** The main application window (no-ops outside Tauri). */
export interface AppWindow {
  show(): Promise<void>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  /** Closes without running close-requested handlers (after they flushed state). */
  destroy(): Promise<void>;
  isMaximized(): Promise<boolean>;
  startResizeDragging(direction: ResizeDirection): Promise<void>;
  setDecorations(decorations: boolean): Promise<void>;
  setTitle(title: string): Promise<void>;
  onResized(handler: () => void): Promise<Unsubscribe>;
  onFocusChanged(handler: (focused: boolean) => void): Promise<Unsubscribe>;
  /** Called with `true` when the OS switches to a dark theme. */
  onThemeChanged(handler: (dark: boolean) => void): Promise<Unsubscribe>;
  /** Runs `handler` before the window closes; the window closes once it resolves. */
  onCloseRequested(handler: () => Promise<void>): Promise<Unsubscribe>;
}

export interface Backend {
  window: AppWindow;

  /** Shows the system folder picker; resolves to the chosen absolute path or null. */
  pickFolder(): Promise<string | null>;
  /** Opens a folder and starts indexing it in the background (see the index:// events). */
  openRoot(path: string): Promise<RootInfo>;
  closeRoot(): Promise<void>;
  /** Restarts indexing with new toggles; resolves to the new generation. */
  rescan(request: RescanRequest): Promise<number>;
  /** Lists an indexed folder (root-relative path, "" for the root). */
  listDir(relPath: string): Promise<DirListing>;
  /** Markdown files sorted by last modification, newest first. */
  listRecentFiles(offset: number, limit: number): Promise<RecentFilesListing>;
  /** Reads a markdown file of the open folder. */
  readMarkdown(relPath: string): Promise<FileContent>;
  /** Reads any text file of the open folder (NotText for binaries, TooLarge above 5 MB). */
  readTextFile(relPath: string): Promise<TextFileContent>;
  /** Opens a text file with the system's default app (Forbidden for programs and scripts). */
  openWithDefaultApp(relPath: string): Promise<void>;
  /** Shows a file or folder of the open folder in the system file manager. */
  revealInFileManager(relPath: string): Promise<void>;
  /** URL the webview can load a file of the open folder from (images, videos). */
  assetUrl(rootPath: string, relPath: string): string;
  /** Opens a media file of the open folder with the system's default application. */
  openExternal(relPath: string): Promise<void>;
  /** Opens an http(s) or mailto URL in the system browser or mail client. */
  openUrl(url: string): Promise<void>;

  /** Progress of the document graph build and the number of broken links. */
  getGraphStatus(): Promise<GraphStatus>;
  /** The links of a document with their status (empty for unparsed documents). */
  getDocLinks(relPath: string): Promise<DocLinks>;
  /** The documents linking to a document. */
  getBacklinks(relPath: string): Promise<Backlinks>;
  /** Every broken link of the folder, grouped by document. */
  listBrokenLinks(): Promise<BrokenLinksReport>;
  /** Fuzzy search over file names and headings (Ctrl+T); `#` restricts to headings. */
  searchSymbols(request: SymbolSearchRequest): Promise<SymbolSearchResult>;
  /** Starts a full-text search; results arrive as `search://results` batches. Resolves to its id. */
  searchText(request: TextSearchRequest): Promise<number>;
  /** Cancels a running text search (idempotent). */
  cancelSearch(searchId: number): Promise<void>;

  getSettings(): Promise<Settings>;
  updateSettings(patch: SettingsPatch): Promise<Settings>;
  getRecentFolders(): Promise<RecentFolder[]>;
  removeRecentFolder(path: string): Promise<RecentFolder[]>;
  clearRecentFolders(): Promise<RecentFolder[]>;
  getSession(rootPath: string): Promise<Session | null>;
  saveSession(rootPath: string, session: Session): Promise<void>;
  getAppInfo(): Promise<AppInfo>;
  /** Opens the app-data folder in the system file manager. */
  openAppDataDir(): Promise<void>;

  /**
   * Whether the AI provider is installed and signed in (runs its probes; spends no tokens). A
   * check younger than a minute is reused unless `force` ("Check again").
   */
  aiStatus(force?: boolean): Promise<AiProviderStatus>;
  aiCapabilities(): Promise<AiCapabilities>;
  /** The providers the "AI provider" setting offers (no probe, no token). */
  aiProviders(): Promise<AiProviderInfo[]>;
  /** Switches the AI provider; refused while an operation runs. Resolves to the new settings. */
  aiSetProvider(id: string): Promise<Settings>;
  /**
   * What the next message would carry for the active file (`null`: none): the provider's
   * instruction files from the root down, then the current file. Paths, roles and sizes only;
   * the contents are read by the backend when the message is sent. Spends no tokens.
   */
  aiContext(currentPath: string | null): Promise<AiContextDocument[]>;
  /** The approximate size of a message, from file metadata. Spends no tokens. */
  aiEstimate(input: AiEstimateInput): Promise<AiSizeEstimate>;
  /**
   * Starts an AI operation in the open folder on behalf of a user action; resolves to its id.
   * The backend reads the context documents from `request.contextPaths`. Its events arrive as
   * `ai://event`, ending with `done`.
   */
  aiStart(action: AiUserAction, request: AiStartRequest): Promise<number>;
  /** Answers a `permissionRequest` event of the running operation. */
  aiRespondPermission(
    operationId: number,
    requestId: string,
    decision: PermissionDecision,
  ): Promise<void>;
  /** Stops the running operation (idempotent); a `done` event follows. */
  aiCancel(operationId: number): Promise<void>;

  /** The AI conversations of the open folder, newest first (app data only). */
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation>;
  /** Adds or replaces a conversation of the open folder; trimmed to `settings.ai.historyLimit`. */
  saveConversation(conversation: Conversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
  /** Deletes every conversation of the open folder. */
  forgetConversations(): Promise<void>;

  /**
   * The project profile of the open folder, built locally from one walk (no AI), cached until
   * the disk changes (`force` rebuilds), with the user's corrections applied.
   */
  getProjectProfile(force?: boolean): Promise<ProjectProfile>;
  /** Saves the corrections of the open folder (app data) and returns the corrected profile. */
  setProfileCorrections(corrections: ProfileCorrections): Promise<ProjectProfile>;
  /** Subject proposals for the open folder (local: the profile and the corpus, no AI). */
  listSubjects(): Promise<Subject[]>;
  /** The quiz being played in the open folder (app data), or null. */
  getCurrentQuiz(): Promise<QuizRecord | null>;
  /** Saves the quiz being played; a finished one (`finishedMs` set) moves to the history. */
  saveCurrentQuiz(record: QuizRecord): Promise<void>;
  clearCurrentQuiz(): Promise<void>;
  /** The finished quizzes of the open folder, newest first. */
  listQuizHistory(): Promise<QuizSummary[]>;
  /** A finished quiz (for Play again, which calls no AI). */
  getQuizRecord(id: string): Promise<QuizRecord>;
  /** Forgets the history and the current quiz of the open folder (quiz files stay). */
  forgetQuizzes(): Promise<void>;
  /**
   * Save results… / Save quiz…: the save dialog on the folder of the kind (settings.learning),
   * then `markdown` written where the user chose. Rejects with `SaveCancelled` when dismissed,
   * and with `NotAQuizFile` for a quiz without its front matter. The only learning write in the folder.
   */
  saveQuizMarkdown(
    kind: QuizSaveKind,
    markdown: string,
    suggestedName: string,
  ): Promise<SavedQuizFile>;
  /** The quiz files of the open folder (`igrasp: quiz` front matter), newest first, from the graph. */
  listQuizFiles(): Promise<QuizFileSummary[]>;
  /**
   * A quiz file to play: `relPath` inside the folder, or without it the file the user picks in
   * the open dialog (anywhere). Rejects with `SaveCancelled` when dismissed, with `NotAQuizFile`
   * for a file without the quiz front matter.
   */
  readQuizFile(relPath?: string): Promise<QuizFileText>;

  /**
   * The Academy's subject cards and the domains for "I'm new to…" of the open folder (local: the
   * profile and the corpus, no AI), followed by the subjects the AI suggested earlier.
   */
  listTutorialSubjects(): Promise<TutorialSubjects>;
  /**
   * The Academy's library: the private tutorials of the open folder (newest first), then the
   * shared ones found in the folder, with the progress. Local.
   */
  listTutorials(): Promise<TutorialSummary[]>;
  /** A tutorial to take, private or shared (`TutorialNotFound` when it is gone). Local. */
  getTutorial(reference: TutorialRef): Promise<Tutorial>;
  /**
   * Saves a private tutorial in app data (after its outline, each chapter, accepted proposals).
   * A new one (empty id) gets its id, date, provider and generation commit; the cited ranges are
   * hashed (a citation already recorded keeps its hash). Never writes in the folder.
   */
  saveTutorial(tutorial: Tutorial): Promise<StoredTutorial>;
  /** Deletes a private tutorial and the progress in it. */
  deleteTutorial(id: string): Promise<void>;
  /** Forgets the private tutorials, every progress, the suggestions and the usage of the folder. */
  forgetTutorials(): Promise<void>;
  getTutorialProgress(id: string): Promise<TutorialProgress | null>;
  /** Saves the reader's progress (after each step). */
  saveTutorialProgress(progress: TutorialProgress): Promise<void>;
  /** Keeps the AI's subject suggestions with the folder; resolves to all of them. */
  saveSuggestedSubjects(subjects: TutorialSubject[]): Promise<TutorialSubject[]>;
  /**
   * What writing a tutorial in the folder would do (its files, new, changed or unchanged, and the
   * chapter files removed), for the confirmation. Writes nothing. `tutorial` is the new version
   * of a shared one (`Shared` target); a private one is written as stored.
   */
  planTutorialWrite(target: WriteTarget, tutorial?: Tutorial): Promise<WritePlan>;
  /**
   * Writes a tutorial after the user confirmed its plan: Share with the project (records where on
   * the private copy), an update of a shared one, or Save as… (the folder dialog runs here;
   * `SaveCancelled` when dismissed). `TutorialFolderTaken` when another tutorial is there.
   */
  writeTutorial(target: WriteTarget, tutorial?: Tutorial): Promise<WrittenTutorial>;
  /**
   * The local freshness check of a tutorial (no token): every cited range against the files.
   * Moved citations of a private tutorial are relocated and saved; for a shared one the
   * relocated version is returned (`relocated`), to write only after a confirmation.
   */
  checkTutorialFreshness(reference: TutorialRef): Promise<FreshnessReport>;
  /**
   * "Mark as verified": the user states the tutorial is correct for the project as it is now.
   * Stamps the date, the HEAD commit and the git user name and hashes the cited ranges again. A
   * private tutorial is saved; a shared one is returned stamped, to write after a confirmation.
   */
  markTutorialVerified(reference: TutorialRef): Promise<Tutorial>;
  /**
   * Saves a reader's question and its answer on a step (no author, no date: anonymous once
   * shared). A private tutorial is saved; a shared one is returned, to write after a
   * confirmation. Local.
   */
  saveStepQuestion(
    reference: TutorialRef,
    chapter: number,
    question: StepQuestion,
  ): Promise<Tutorial>;
  /** Removes the `index`-th saved question of a chapter (same rules as saving). */
  removeStepQuestion(reference: TutorialRef, chapter: number, index: number): Promise<Tutorial>;

  listen<E extends EventName>(
    event: E,
    handler: (payload: BackendEvents[E]) => void,
  ): Promise<Unsubscribe>;
}
