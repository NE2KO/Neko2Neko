# DEBUG IDs — Media Vault

> Setiap komponen UI punya ID unik. Hover dengan debug ON untuk lihat ID.

---

## 1. Media Browser

```
1         MediaVaultRoot         | App root
1.1.1.1   NavMedia               | Sidebar nav: Media
1.1.1.2   NavMonitoring          | Sidebar nav: Monitoring
1.1.1.3   NavDownloader          | Sidebar nav: Downloader
1.1.1.4   NavAdb                 | Sidebar nav: ADB Transfer
1.1.1.5   NavPlaylists           | Sidebar nav: Playlists
1.1.1.6   NavWhatsApp            | Sidebar nav: WhatsApp Bot
1.1.3     SearchBar              | Search container
1.1.3.1   SearchInput            | Search input field
1.1.6     MediaGrid              | react-window grid
1.1.6.1   MediaRow               | Grid row item
1.1.6.1.1 Thumbnail              | File thumbnail
1.1.6.1.2 GridMeta               | File metadata
1.1.6.1.4 GridTypeIcon           | Type icon (video/audio/image)
1.1.9     MediaModal             | Modal overlay
1.1.9.1   Carousel               | Thumbnail strip
1.1.9.2   VideoPlayer            | Video player
1.1.9.3   AudioPlayer            | Audio player
1.1.9.4   ImageViewer            | Image viewer
1.1.9.5   MediaControls          | Play/pause/seek/volume
1.1.9.6   MetadataEditor         | Metadata sidebar
1.2       MiniPlayer             | Bottom bar
1.2.1     MiniPlayPause          | Play/pause button
1.2.2     MiniSeekBar            | Progress bar
1.2.4     MiniTrackInfo          | Track title
1.2.5     MiniPrevNext           | Prev/next buttons
```

## 2. Monitoring

### 2.1 Layout

```
2.1       MonitoringLayout       | Shell container
2.1.1     Sidebar                | Left sidebar
2.1.2     TopBar                 | Top bar
2.1.2.1   Clock                  | Clock display
2.1.2.2   AlertBadge             | Alert count
2.1.2.4   MiniStatCpu            | CPU stat in topbar
2.1.2.5   MiniStatRam            | RAM stat in topbar
2.1.2.6   MiniStatDisk           | DISK stat in topbar
2.1.2.7   MiniStatGpu            | GPU stat in topbar
```

### 2.2 Overview

```
2.2       OverviewPage           | Dashboard page
2.2.1.1   QuickStatIcon          | QuickStat icon
2.2.1.2   QuickStatValue         | QuickStat big number
2.2.1.3   QuickStatLabel         | QuickStat label
2.2.5     UptimeRow              | Uptime display
2.2.5.2   UptimeSince            | Since date
2.2.6     CpuWidget              | CPU widget
2.2.6.1   CpuStats               | User/Sys/IOWait
2.2.6.2   CpuInfo                | Load/Threads
2.2.6.3   PerCoreFrequency       | Per-core freq container
2.2.6.3.1 FreqBar                | Frequency bar (×12)
2.2.6.3.2 FreqGradientBar        | Freq gradient bar
2.2.6.4   PerCoreUsage           | Per-core usage container
2.2.6.4.1 CoreMiniGauge          | MiniGauge per core (×12)
2.2.6.5   TemperatureSensors     | Temp sensor container
2.2.6.6   CpuCard                | GlassCard wrapper
2.2.7     MemoryWidget           | Memory widget
2.2.7.1   MemoryBar              | RAM bar
2.2.7.2   MemoryStats            | Used/Free/Total
2.2.7.3   BarRow                 | Bar row container
2.2.7.3.1 MemGradientBar         | Memory gradient bar
2.2.7.4   InfoRow                | Info row container
2.2.7.5   MemoryCard             | GlassCard wrapper
2.2.8     DiskWidget             | Disk widget
2.2.8.1   DiskIoBar              | I/O bar
2.2.8.2   DiskList               | Disk list
2.2.8.3   ReadSpeed              | Read speed text
2.2.8.4   WriteSpeed             | Write speed text
2.2.8.5   DiskCard               | GlassCard wrapper
2.2.9     GpuWidget              | GPU widget
2.2.9.1   GpuStats               | GPU stats
2.2.9.2   VramBar                | VRAM bar
2.2.9.3   GpuInfo                | Driver/temp info
2.2.9.4   GpuCardA               | GlassCard (no GPU)
2.2.9.5   GpuCardB               | GlassCard (with GPU)
2.2.10    NetworkWidget          | Network widget
2.2.10.1  NetworkInfo            | Network info
2.2.10.2  SpeedDisplay           | Up/down speed
2.2.10.3  IfaceDetail            | Interface detail
2.2.10.4  NetworkCard            | GlassCard wrapper
2.2.11    SystemWidget           | System widget
2.2.11.1  SystemBadges           | OS badges
2.2.11.2  UsersList              | Logged-in users
2.2.11.3  SystemInfo             | System info
2.2.11.4  SystemCard             | GlassCard wrapper
2.2.12    MiniGauge              | SVG arc gauge
2.2.15    OverviewDockerCard     | Overview docker card
2.2.16    OverviewDockerStats    | Docker stats card
2.2.17    OverviewServices       | Services card
2.2.18    OverviewAlerts         | Recent alerts card
2.2.19    OverviewLogs           | Recent logs card
```

### 2.3 MetricsTable

```
2.3       MetricsTable           | Metrics page
2.3.1     RangeSelector          | 1H/6H/12H/24H/3D/7D/30D
2.3.2     MetricGaugeRow         | 8-column gauge grid
2.3.3     MetricChart            | recharts wrapper
2.3.4     DataTable              | Data table (max 500)
2.3.4.1   SortHeader             | Column sort buttons
2.3.4.2   TableRow               | Data row
2.3.5     MetricsGauges          | Gauges GlassCard
2.3.6     MetricsTrend           | Trend GlassCard
2.3.7     MetricsAllOverlay      | All metrics overlay card
2.3.8     MetricsDistribution    | Distribution card
2.3.9     MetricsDataTableCard   | Data table card
2.3.10    MetricsFooter          | Footer card
```

### 2.4 Status

```
2.4       StatusPage             | Status page
2.4.1     RestartAllButton       | Restart all button
2.4.3     ServerInfoCard         | Server info card
2.4.4     MemoryCard             | Memory card
2.4.5     SystemLoadCard         | System load card
2.4.6     TopQueueCard           | Top queue card
2.4.7     StatusServicesCard     | Services card
2.4.8     StatusDockerCard       | Docker card
2.4.9     StatusControlCard      | Control card
```

### 2.5 Network

```
2.5       NetworkPage            | Network page
2.5.1     InterfaceSummaryCard   | Summary card
2.5.2     InterfaceCard          | Per-interface card
2.5.2.1   IfaceDetail            | Interface detail
2.5.4     NetworkSummaryCard     | Network summary card
```

### 2.6 Storage

```
2.6       StoragePage            | Storage page
2.6.1     FilesystemsCards       | Filesystems grid
2.6.1.1   FilesystemCard         | Per-filesystem card
2.6.1.1.1 FsGaugeMeter           | Filesystem gauge
2.6.2     DiskIoCards            | Disk I/O grid
2.6.2.1   DiskIoCard             | Per-disk I/O card
2.6.3     PartitionsTable        | Partitions table
2.6.3.1   PartitionRow           | Partition row
2.6.4     PartitionsCard         | Partitions card
```

### 2.7 Processes

```
2.7       ProcessesPage          | Processes page
2.7.1     ProcessSearch          | Search input
2.7.2     ProcessTable           | Sortable table
2.7.2.1   ProcessRow             | Process row
2.7.3     ProcessListCard        | Process list card
```

### 2.8 Services

```
2.8       ServicesPage           | Services page
2.8.1     DockerTab              | Docker tab
2.8.1.1   ContainerList          | Container list
2.8.1.1.1 ContainerItem          | Container row
2.8.2     SystemdTab             | Systemd tab
2.8.2.1   ServicesTable          | Service table
2.8.3     ServicesMainCard       | Main services card
```

### 2.9 ServiceControl

```
2.9       ServiceControlPage     | Service control page
2.9.1     RestartAllButton       | Restart all button
2.9.2     ServiceCard            | Per-service card
2.9.2.1   ServiceStatus          | Status indicator
2.9.2.2   ServiceButtons         | Start/Stop/Restart
```

### 2.10 Logs

```
2.10      LogsPage               | Logs page
2.10.1    LogFilter              | Filter input
2.10.2    UnitFilter             | Unit filter dropdown
2.10.3    LineCount              | Line count selector
2.10.4    AutoRefresh            | Auto-refresh toggle
2.10.6    LogTerminalCard        | Log terminal card
```

### 2.11 Alerts

```
2.11      AlertsPage             | Alerts page
2.11.1    ThresholdConfig        | Threshold inputs
2.11.2    AlertHistoryTable      | Alert history table
2.11.3    ThresholdsCard         | Thresholds card
2.11.4    AlertHistoryCard       | Alert history card
```

### 2.12 MediaStats

```
2.12      MediaStatsPage         | Media stats page
2.12.1    StatsCards             | Stats grid
2.12.1.1  StatTotalFiles         | Total files card
2.12.1.2  StatTotalSize          | Total size card
2.12.1.3  StatVideoCount         | Video count card
2.12.1.4  StatAudioCount         | Audio count card
2.12.2    TypeDistribution       | Type distribution grid
2.12.3    FileBreakdown          | File breakdown card
2.12.4    DatabaseInfo           | Database info card
2.12.5    ThumbnailSection       | Thumbnail section card
2.12.6    UploadStatsCard        | Upload stats card
2.12.7    ActionButtons          | Action buttons
2.12.8    ActivityLogCard        | Activity log card
2.12.9    MediaStatsFooter       | Footer card
```

### 2.13 Settings

```
2.13      SettingsPage           | Settings page
2.13.1    CategoryTabs           | 15 category tabs
2.13.2    SettingRow             | Setting row
2.13.3    SettingCategoryCard    | Category card
2.13.4    SettingPreviewCard     | Preview card
2.13.5    SettingRawCard         | Raw config card
```

### 2.14 WhatsApp (Monitoring)

```
2.14      WhatsAppPage           | WhatsApp monitoring page
2.14.1    StatusCard             | Connection status card
2.14.2    ConfigEditorCard       | Config editor card
2.14.3    AllowedGroupsCard      | Allowed groups card
2.14.4    LogsCard               | Logs card
```

### 2.15 Charts

```
2.15      ChartsPage             | Charts page
2.15.1    ChartContainer         | Chart container
2.15.2    ChartSelector          | Chart selector
```

### 2.16 Docker / Sessions

```
2.16      DockerPage             | Docker page
2.16.1    ContainerList          | Container list
2.16.2    ImageList              | Image list
2.16.3    SessionCard1           | Session card 1
2.16.4    SessionCard2           | Session card 2
2.16.5    SessionCard3           | Session card 3
2.16.6    SessionCard4           | Session card 4
2.16.7    SessionMainCard        | Session main card
```

### 2.17 Tasks

```
2.17      TasksPage              | Tasks page
2.17.1.3  TaskList               | Task list
2.17.1.4  ProgressBar            | Progress bar
2.17.2    QueuesTab              | Queues tab
2.17.3    EngineCard             | Engine card
2.17.3.1  StatPollInterval       | Poll interval stat
2.17.3.2  StatCollectors         | Collectors stat
2.17.3.3  StatHistory            | History stat
2.17.3.4  StatAlerts             | Alerts stat
2.17.4    WatcherCard            | Watcher card
2.17.4.1  StatWatcherStatus      | Watcher status stat
2.17.4.2  StatPendingRescan      | Pending rescan stat
2.17.4.3  StatFilesProcessed     | Files processed stat
2.17.5    QueueCard              | Queue card (in map)
2.17.6    QueuePageCard          | Queue page card
```

### 2.18 Jobs

```
2.18      JobsPage               | Jobs page
2.18.1    JobList                | Job list
2.18.2    JobItem                | Job row (×2)
2.18.3    JobsOverviewCard       | Jobs overview card
2.18.3.1  StatPollInterval       | Poll interval stat
2.18.3.2  StatCollectors         | Collectors stat
2.18.3.3  StatHistory            | History stat
2.18.3.4  StatAlerts             | Alerts stat
2.18.3.5  StatWatcherStatus      | Watcher status stat
2.18.3.6  StatPendingRescan      | Pending rescan stat
2.18.3.7  StatFilesProcessed     | Files processed stat
```

## 3. Downloader

```
3.1       DownloaderPage         | Downloader page
3.1.6.1   UrlInput               | URL input
3.1.6.2   QualitySelector        | Quality selector
3.1.7     DownloadQueue          | Download list
3.1.7.1   QueueItem              | Queue row
3.1.7.2   ProgressBar            | Download progress
3.1.7.3   SpeedEta               | Speed + ETA
3.1.7.4   CancelButton           | Cancel button
```

## 4. ADB Transfer

```
4.1       AdbTransfer            | ADB transfer panel
4.1.1     DeviceSelector         | Device dropdown
4.1.2     ServerFilePane         | Left pane (server)
4.1.3     PhoneFilePane          | Right pane (phone)
4.1.4     TransferButtons        | Push/Pull/Cancel
4.1.5     TransferHistory        | Job history
```

## 5. Playlists

```
5.1       PlaylistView           | Playlist view
5.1.1     ViewToggle             | List/grid toggle
5.1.2.2   ImportXSPFButton       | Import XSPF
5.1.2.3   CreatePlaylistButton   | Create button
5.1.3     PlaylistGrid           | Grid view
5.1.4     PlaylistList           | List view
5.2.1     PlaylistDetailHeader   | Detail header
5.2.2     TrackListView          | Track list
5.2.3     TrackGridView          | Track grid
5.2.4     AddMusicPanel          | Add music panel
5.2.5     QueuePanel             | Queue panel
```

## 7. WhatsApp

```
7.1       WhatsAppView           | WhatsApp bot panel
7.1.1     WhatsAppStatusCard     | Status card
7.1.2     WhatsAppConfigCard     | Config card
7.1.3     WhatsAppGroupsCard     | Groups card
7.1.4     WhatsAppLogsCard       | Logs card
```

## Shared

```
S.1       GlassCard              | Default (override via parent)
S.4       GradientBar            | Default (override via parent)
X.1       HeaderComponents       | Header area
X.2       ToastContainer         | Toast notifications
X.3       ServiceStoppedBanner   | Backend down banner
A.2       ConfirmModal           | Confirm dialog
A.7       UploadsMonitor         | Upload progress panel
A.7.1     UploadItem             | Upload row
```

---

**Total: 250+ unique debug IDs**

*Cara pakai: Toggle debug mode (pill switch di sidebar) → hover elemen → lihat `[ID] Name]` di tooltip.*
