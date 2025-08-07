// ==UserScript==
// @name         Menu
// @namespace    http://tampermonkey.net/
// @version      2.1
// @description  Enhanced helper for Wolvesville with Collapsible Menu, Updated APIs, Auto Play Custom (Cupid). Refactored with Classes. Extended Debug Logs.
// @author       VietTD
// @match        *://*.wolvesville.com/*
// @require      https://code.jquery.com/jquery-3.7.1.min.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.7.5/socket.io.min.js
// @grant        GM_info
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_xmlhttpRequest
// @grant        unsafeWindow
// @connect      core.api-wolvesville.com
// @connect      auth.api-wolvesville.com
// @connect      game.api-wolvesville.com
// @connect      game-asia.api-wolvesville.com
// @connect      *.wolvesville.com
// @connect      127.0.0.1
// ==/UserScript==

/* jshint esversion: 8, evil: true, newcap:false */
/* global io, unsafeWindow, $, GM_setValue, GM_getValue */

(function() {
    'use strict';

    const SCRIPT_NAME = GM_info.script.name;
    const SCRIPT_VERSION = GM_info.script.version;
    const MAX_CHAT_MESSAGES = 50;
	function sendCommandToPython(commandName, payload = {}) {
		const url = 'http://127.0.0.1:5000/command'; // URL của server Python
		const dataToSend = {
			command: commandName,
			timestamp: new Date().toISOString(),
			...payload
		};

		// Ghi log trong trình duyệt
		console.log(`[Tampermonkey] Đang gửi lệnh tới Python: '${commandName}'`, dataToSend);

		// GM_xmlhttpRequest là hàm của Tampermonkey để gửi yêu cầu HTTP
		GM_xmlhttpRequest({
			method: "POST",
			url: url,
			headers: {
				"Content-Type": "application/json"
			},
			data: JSON.stringify(dataToSend),
			onload: function(response) {
				console.log(`[Tampermonkey] Python đã nhận lệnh '${commandName}'. Phản hồi:`, response.responseText);
			},
			onerror: function(error) {
				console.error(`[Tampermonkey] Lỗi khi gửi lệnh '${commandName}' tới Python:`, error);
				mainController.uiManager.addChatMessage(`Lỗi gửi lệnh '${commandName}' tới Python.`, true, 'color: #e74c3c;');
			}
		});
	}

    class StateManager {
        constructor() {
            this.AUTHTOKENS = {
                idToken: '',
                refreshToken: '',
                'Cf-JWT': '',
            };
            this.PLAYER = undefined;
            this.CURRENT_GAME = {
                id: undefined,
                serverUrl: undefined,
                settings: undefined,
                status: undefined,
                startedAt: 0,
                role: undefined,
                players: [],
                chatMessages: [],
                lovers: [],
                deads: [],
                juniorWerewolfTarget: undefined,
                werewolfNightActionSent: false,
                werewolves: [],
                targetWerewolfVote: undefined,
                loverAnnounced: false
            };
            this.IS_MENU_EXPANDED = true;
            this.IS_GAME_OVER = false;
            this.SETTINGS = {
                debugMode: false,
                customTitle: `🐺 ${SCRIPT_NAME} v${SCRIPT_VERSION} 🐺`,
                autoFetchPlayerData: true,
                autoPlayCustomCupidEnabled: true,
                dimmedModeEnabled: true,
                uiOpacity: 0.8
            };
            this.MAIN_SOCKET_LISTENER_ACTIVE = false;
            this.CUSTOM_GAME_SOCKET = undefined;
            this.GAME_COUNT_FOR_REFRESH = 0;
            console.log(`[${SCRIPT_NAME}] StateManager initialized.`);
        }

        async init() {
            this.GAME_COUNT_FOR_REFRESH = await GM_getValue('gameCountForRefresh', 0);
            console.log(`[${SCRIPT_NAME}] StateManager: Loaded GAME_COUNT_FOR_REFRESH: ${this.GAME_COUNT_FOR_REFRESH}`);
        }

        getRoleById(roleId) {
            try {
                const rMD = JSON.parse(localStorage.getItem('roles-meta-data'));
                if (rMD && rMD.roles && rMD.roles[roleId]) {
                    return rMD.roles[roleId];
                }
            } catch (e) {
                console.error(`[${SCRIPT_NAME}] getRoleById: Error parsing roles-meta-data from localStorage:`, e);
            }
            if (typeof roleId === 'object' && roleId !== null && roleId.id) {
                return roleId;
            }
            return { id: roleId, name: roleId, team: 'UNKNOWN' };
        }

        getXpForNextLevel(currentLevel, currentXpTotal) {
            const xpForCurrentLevel = (Math.pow(currentLevel, 2) + currentLevel) * 50;
            const xpForNextLevel = (Math.pow(currentLevel + 1, 2) + (currentLevel + 1)) * 50;
            const xpNeeded = xpForNextLevel - currentXpTotal;
            return { xpNeeded, xpForNextLevel };
        }

        resetGameState() {
            console.log(`[${SCRIPT_NAME}] StateManager: Resetting game state...`);
            this.CURRENT_GAME = {
                id: undefined,
                serverUrl: undefined,
                settings: undefined,
                status: undefined,
                startedAt: 0,
                role: undefined,
                players: [],
                chatMessages: [],
                lovers: [],
                deads: [],
                juniorWerewolfTarget: undefined,
                werewolfNightActionSent: false,
                werewolves: [],
                targetWerewolfVote: undefined,
                loverAnnounced: false
            };
            if (this.PLAYER) {
                this.PLAYER.isAlive = true;
                console.log(`[${SCRIPT_NAME}] StateManager: Player status reset to alive.`);
            }
            this.IS_GAME_OVER = false;
            console.log(`[${SCRIPT_NAME}] StateManager: Game state reset complete.`);
        }
    }

    class Logger {
        constructor(stateManager) {
            this.state = stateManager;
            console.log(`[${SCRIPT_NAME}] Logger initialized.`);
        }

        log(message, data) {
            if (this.state.SETTINGS.debugMode) {
                if (data !== undefined) {
                    console.log(`[${SCRIPT_NAME}]`, message, data);
                } else {
                    console.log(`[${SCRIPT_NAME}]`, message);
                }
            }
        }
    }

    class UiManager {
        constructor(stateManager, logger, apiHandler) {
            this.state = stateManager;
            this.logger = logger;
            this.apiHandler = apiHandler;
            this.logger.log(`UiManager initialized.`);
        }

        async init() {
            this.logger.log('UiManager: Initializing UI components...');
            await this.loadSettingsFromGM();
            this.injectMyUI();
            this.bindEvents();
            this.applySettingsChanges();
            this.logger.log('UiManager: UI initialization complete.');
        }

        async loadSettingsFromGM() {
            this.logger.log('UiManager: Loading settings from GM_setValue...');
            const storedOpacity = await GM_getValue('uiOpacity', this.state.SETTINGS.uiOpacity);
            const storedDimmedMode = await GM_getValue('dimmedModeEnabled', this.state.SETTINGS.dimmedModeEnabled);

            this.state.SETTINGS.uiOpacity = storedOpacity;
            this.state.SETTINGS.dimmedModeEnabled = storedDimmedMode;
            this.logger.log('UiManager: Settings loaded from GM_setValue:', { uiOpacity: storedOpacity, dimmedModeEnabled: storedDimmedMode });
        }

        async saveSettingsToGM() {
            this.logger.log('UiManager: Saving settings to GM_setValue...');
            await GM_setValue('uiOpacity', this.state.SETTINGS.uiOpacity);
            await GM_setValue('dimmedModeEnabled', this.state.SETTINGS.dimmedModeEnabled);
            this.logger.log('UiManager: Settings saved to GM_setValue.');
        }

		addChatMessage(message, strong = false, style = '') {
            this.logger.log(`[UI CHAT] Adding message: ${message.replace(/<[^>]*>?/gm, '')}`);
            const chatArea = $('#wvHelperProPlayerInfoDisplay');
            if (chatArea.length) {
                const formattedMessage = strong ? `<strong>${message}</strong>` : message;

                // Thêm dòng log mới vào cuối
                chatArea.append(`<p style="${style}; margin: 2px 0;">[${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}] ${formattedMessage}</p>`);

                // Kiểm tra và xóa dòng log cũ nhất nếu vượt quá 50
                const logEntries = chatArea.children('p');
                if (logEntries.length > 50) {
                    logEntries.first().remove(); // Xóa phần tử <p> đầu tiên (cũ nhất)
                }

                // Cuộn xuống dưới cùng
                chatArea.scrollTop(chatArea.prop("scrollHeight"));
                this.logger.log(`[UI CHAT] Message added to UI.`);
            } else {
                this.logger.log(`[UI CHAT] Chat area #wvHelperProPlayerInfoDisplay not found.`);
            }
        }

        updateTokenStatusUI() {
            this.logger.log('UiManager: Updating token status UI...');
            let statusText = 'ID Token: Not Found';
            let color = '#e74c3c';

            if (this.state.AUTHTOKENS.idToken) {
                statusText = 'ID Token: Found';
                color = '#2ecc71';
                if (this.state.AUTHTOKENS['Cf-JWT']) {
                    statusText += ' | Cf-JWT: Found';
                } else {
                    statusText += ' | Cf-JWT: Not Found';
                    color = '#f39c12';
                }
            }
            $('#wvHelperProTokenStatus').text(statusText).css('color', color);
            this.logger.log(`UiManager: Token status UI updated: ${statusText}`);
        }

        updateMainMenuDisplay() {
            this.logger.log('UiManager: Updating main menu display (expand/collapse)...');
            const $container = $('#wvHelperProContainer');
            const $content = $('#wvHelperProMenuContent');
            const $toggleButton = $('#wvHelperProMenuToggle');

            if (this.state.IS_MENU_EXPANDED) {
                this.logger.log('UiManager: Expanding menu.');
                $toggleButton.html('&#xf078;'); // Mũi tên lên (hoặc biểu tượng X nếu muốn)
                $container.css({
                    'width': '330px',
                    'height': 'auto',
                    'padding': '0px',
                    'border-radius': '8px',
                    'background-color': 'transparent',
                    'box-shadow': 'none',
                    'pointer-events': 'auto'
                });
                $toggleButton.css({
                    'opacity': '0',
                    'pointer-events': 'none'
                });
                $content.css({
                    'opacity': '1',
                    'transform': 'scale(1)',
                    'pointer-events': 'auto'
                });
            } else {
                this.logger.log('UiManager: Collapsing menu.');
                $toggleButton.html('&#x2699;'); // Bánh răng
                $container.css({
                    'width': '40px',
                    'height': '40px',
                    'padding': '0px',
                    'border-radius': '50%',
                    'background-color': '#3d8bfd',
                    'box-shadow': '0 2px 8px rgba(0,0,0,0.5)',
                    'pointer-events': 'auto'
                });
                $toggleButton.css({
                    'opacity': '1',
                    'pointer-events': 'auto'
                });
                $content.css({
                    'opacity': '0',
                    'transform': 'scale(0.8)',
                    'pointer-events': 'none'
                });
            }
            this.logger.log('UiManager: Main menu display update finished.');
        }

        applySettingsChanges() {
            this.logger.log('UiManager: Applying settings changes...');
            if (this.state.SETTINGS.customTitle) {
                document.title = this.state.SETTINGS.customTitle;
                this.logger.log(`UiManager: Document title set to: ${this.state.SETTINGS.customTitle}`);
            }
            this.updateMainMenuDisplay();
            this.updateUiOpacity();
            this.logger.log('UiManager: Settings changes applied.');
        }

        updateUiOpacity() {
            this.logger.log(`UiManager: Updating UI Opacity. DimmedMode: ${this.state.SETTINGS.dimmedModeEnabled}, Opacity: ${this.state.SETTINGS.uiOpacity}.`);
            const $container = $('#wvHelperProContainer');
            if (this.state.SETTINGS.dimmedModeEnabled) {
                $container.css('opacity', this.state.SETTINGS.uiOpacity);
            } else {
                $container.css('opacity', 1);
            }
            $('#wvHelperProOpacityRange').val(this.state.SETTINGS.uiOpacity);
            $('#wvHelperProOpacityValue').text(this.state.SETTINGS.uiOpacity);
            $('#wvHelperProDimmedModeToggle').prop('checked', this.state.SETTINGS.dimmedModeEnabled);
        }

        clearConsoleLog() {
            this.logger.log('UiManager: Clearing console log in UI.');
            $('#wvHelperProPlayerInfoDisplay').html('<p>Console đã được xóa.</p>');
            this.addChatMessage('Console log đã được xóa!', false, 'color: #e74c3c;');
        }

        copyConsoleLog() {
            this.logger.log('UiManager: Attempting to copy console log.');
            const logContent = $('#wvHelperProPlayerInfoDisplay').text();
            navigator.clipboard.writeText(logContent).then(() => {
                this.addChatMessage('Console log đã được sao chép!', false, 'color: #27ae60;');
                this.logger.log('UiManager: Console log copied successfully.');
            }).catch(err => {
                this.addChatMessage('Không thể sao chép console log.', true, 'color: #e74c3c;');
                this.logger.log(`UiManager: Failed to copy console log: ${err.message}`, err);
                console.error(`[${SCRIPT_NAME}] Lỗi khi sao chép console log:`, err);
            });
        }

        injectMyUI() {
            this.logger.log('UiManager: Injecting UI elements into DOM.');
            const $uiContainer = $(`
				<div id="wvHelperProContainer" style="
                    position: fixed; right: 10px; bottom: 10px;
                    z-index: 2147483647;
                    background-color: #3d8bfd; /* Màu nền icon khi ẩn */
                    padding: 0;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.5);
                    width: 40px; height: 40px;
                    border-radius: 50%;
                    display: flex; justify-content: center; align-items: center;
                    color: white; font-size: 24px;
                    opacity: 0.9;
                    cursor: pointer;
                    transition: all 0.3s ease-in-out;
                    overflow: visible; /* Cho phép nội dung menu tràn ra */
                    border: 1px solid #4a4a4f; /* Thêm border cho icon */
				">
                    <div id="wvHelperProMenuToggle" style="
                        font-family: 'Font Awesome 5 Free';
                        font-weight: 900;
                        line-height: 1;
                        vertical-align: middle;
                        opacity: 1; /* Biểu tượng luôn hiển thị khi menu ẩn */
                        pointer-events: auto; /* Luôn tương tác được với icon */
                        transition: opacity 0.3s ease-in-out;
                    ">&#x2699;</div>

                    <div id="wvHelperProMenuContent" style="
                        position: absolute;
                        bottom: 0; right: 0;
                        width: 300px;
                        height: auto;
                        max-height: 500px;
                        background-color: #202022;
                        border: 1px solid #4a4a4f;
                        border-radius: 8px;
                        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                        padding: 15px;
                        opacity: 0;
                        transform: scale(0.8);
                        transform-origin: bottom right;
                        transition: opacity 0.3s ease-in-out, transform 0.3s ease-in-out;
                        pointer-events: none;
                        display: flex; flex-direction: column; /* Để sắp xếp nội dung */
                    ">
                        <h4 style="margin: 0 0 10px 0; color: #6cb6ff; font-weight: 500;">
                            ${SCRIPT_NAME} v${SCRIPT_VERSION}
                        </h4>

                        <div class="wv-section">
                            <h5 class="wv-section-title">Trạng thái xác thực</h5>
                            <p id="wvHelperProTokenStatus" style="font-weight: bold; font-size:11px; margin-bottom: 8px;">Đang kiểm tra...</p>
                        </div>

                        <div class="wv-section">
                            <h5 class="wv-section-title">Log & Thông tin</h5>
                            <div id="wvHelperProPlayerInfoDisplay" style="max-height: 200px; overflow-y: auto; background: #2a2a2e; padding: 8px; border-radius: 4px; font-size: 11px; line-height: 1.5; color: #c7c7c7; border: 1px solid #3a3a3f;">
                                <p>Log sẽ xuất hiện ở đây.</p>
                            </div>
                            <button id="wvHelperProFetchData" class="wv-button" style="margin-top: 10px;">Lấy dữ liệu người chơi</button>
                            <div style="display: flex; gap: 5px; margin-top: 5px;">
                                <button id="wvHelperProCopyConsole" class="wv-button wv-button-secondary" style="flex-grow: 1;">Sao chép Log</button>
                                <button id="wvHelperProClearConsole" class="wv-button wv-button-secondary" style="flex-grow: 1;">Xóa Log</button>
                            </div>
                        </div>

                        <div class="wv-section" style="margin-bottom: 0; padding-bottom: 0; border-bottom: none;">
                            <h5 class="wv-section-title">Cài đặt</h5>
                            <label class="wv-checkbox-label">
                                <input type="checkbox" id="wvHelperProDimmedModeToggle">
                                Chế độ mờ UI
                            </label>
                            <label class="wv-checkbox-label" style="display: block; margin-top: 10px;">
                                Độ trong suốt UI: <span id="wvHelperProOpacityValue"></span>
                                <input type="range" id="wvHelperProOpacityRange" min="0.1" max="1.0" step="0.05" style="width: 100%; margin-top: 5px;">
                            </label>
                        </div>
                    </div>
                </div>
            `);

            const $styles = $(`
                <style>
                    #wvHelperProContainer ::-webkit-scrollbar { width: 7px; }
                    #wvHelperProContainer ::-webkit-scrollbar-track { background: #2a2a2e; border-radius:3px;}
                    #wvHelperProContainer ::-webkit-scrollbar-thumb { background: #55595c; border-radius:3px;}
                    #wvHelperProContainer ::-webkit-scrollbar-thumb:hover { background: #6c6f72; }
                    .wv-section { margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #38383b; }
                    .wv-section:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0;}
                    .wv-section-title { margin-top: 0; margin-bottom: 10px; color: #9a9a9e; font-size: 10px; text-transform: uppercase; font-weight: 600; letter-spacing: 0.5px;}
                    .wv-button {
                        background-color: #3d8bfd; color: white; border: none; border-radius: 5px;
                        padding: 8px 12px; cursor: pointer; font-size: 12px; margin-top: 5px; display: block; width: 100%;
                        transition: background-color 0.15s ease-in-out, box-shadow 0.15s ease-in-out; font-weight: 500;
                        box-shadow: 0 1px 2px rgba(0,0,0,0.1);
                    }
                    .wv-button:hover { background-color: #529bff; box-shadow: 0 2px 4px rgba(0,0,0,0.15); }
                    .wv-button-secondary { background-color: #48484c; }
                    .wv-button-secondary:hover { background-color: #5a5a5e; }
                    .wv-checkbox-label { display: flex; align-items: center; margin-bottom: 8px; font-size: 12px; color: #d0d0d0; }
                    .wv-checkbox-label input { margin-right: 8px; vertical-align: middle; width: 15px; height: 15px; accent-color: #3d8bfd;}
                    .wv-menu-button:hover, .wv-section-toggle:hover { color: #8ec9ff !important; }
                    .wv-toggle-icon {
                        font-family: "Font Awesome 5 Free";
                        font-weight: 900;
                        font-size: 14px;
                        color: #9a9a9e;
                        transition: transform 0.4s ease-in-out;
                    }
                    .wv-section-toggle.expanded .wv-toggle-icon {
                        transform: rotate(180deg);
                    }
                </style>
            `);
            $('head').append($styles);
            $('body').append($uiContainer);
            this.logger.log('UiManager: UI elements injected.');
        }

        bindEvents() {
            this.logger.log('UiManager: Binding UI events...');
            $('#wvHelperProFetchData').on('click', () => {
                this.logger.log('UiManager: Fetch Player Data button clicked.');
                this.apiHandler.fetchPlayerData();
            });
            $('#wvHelperProContainer').on('mouseenter', function() {
                mainController.uiManager.logger.log('UI: Container mouseenter. Showing menu.');
                mainController.stateManager.IS_MENU_EXPANDED = true;
                mainController.uiManager.updateMainMenuDisplay();
            }).on('mouseleave', function() {
                mainController.uiManager.logger.log('UI: Container mouseleave. Hiding menu.');
                mainController.stateManager.IS_MENU_EXPANDED = false;
                mainController.uiManager.updateMainMenuDisplay();
            });
            // Nút toggle chỉ để đóng/mở thủ công nếu menu đang mở/đóng
            $('#wvHelperProMenuToggle').on('click', () => {
                this.logger.log('UiManager: Menu Toggle button clicked.');
                this.state.IS_MENU_EXPANDED = !this.state.IS_MENU_EXPANDED;
                this.updateMainMenuDisplay();
            });
            $('#wvHelperProCopyConsole').on('click', () => {
                this.logger.log('UiManager: Copy Console button clicked.');
                this.copyConsoleLog();
            });
            $('#wvHelperProClearConsole').on('click', () => {
                this.logger.log('UiManager: Clear Console button clicked.');
                this.clearConsoleLog();
            });
            $('#wvHelperProDimmedModeToggle').on('change', (event) => {
                this.state.SETTINGS.dimmedModeEnabled = event.target.checked;
                this.logger.log(`UiManager: Dimmed Mode toggled to: ${this.state.SETTINGS.dimmedModeEnabled}`);
                this.updateUiOpacity();
                this.saveSettingsToGM();
            });
            $('#wvHelperProOpacityRange').on('input', (event) => {
                this.state.SETTINGS.uiOpacity = parseFloat(event.target.value);
                $('#wvHelperProOpacityValue').text(this.state.SETTINGS.uiOpacity);
                this.logger.log(`UiManager: UI Opacity changed to: ${this.state.SETTINGS.uiOpacity}`);
                this.updateUiOpacity();
            });
            $('#wvHelperProOpacityRange').on('change', () => {
                this.saveSettingsToGM();
            });
            this.logger.log('UiManager: UI events bound.');
        }
    }

    class ApiHandler {
        constructor(stateManager, logger, uiManager, socketHandler) {
            this.state = stateManager;
            this.logger = logger;
            this.uiManager = uiManager;
            this.socketHandler = socketHandler;
            this.logger.log(`ApiHandler initialized.`);
        }

        getAuthTokensFromLocalStorage() {
            this.logger.log('ApiHandler: Attempting to get auth tokens from localStorage...');
            try {
                const authtokensLS = localStorage.getItem('authtokens');
                if (authtokensLS) {
                    const parsedTokens = JSON.parse(authtokensLS);
                    if (parsedTokens && parsedTokens.idToken) {
                        this.state.AUTHTOKENS.idToken = parsedTokens.idToken;
                        this.state.AUTHTOKENS.refreshToken = parsedTokens.refreshToken || '';
                        this.logger.log('ApiHandler: Auth tokens retrieved from localStorage.', { idToken: this.state.AUTHTOKENS.idToken ? 'found' : 'not found', refreshToken: this.state.AUTHTOKENS.refreshToken ? 'found' : 'not found' });
                    } else {
                        this.logger.log('ApiHandler: Failed to parse idToken from localStorage (parsedTokens or idToken missing).', parsedTokens);
                    }
                } else {
                    this.logger.log('ApiHandler: No "authtokens" item found in localStorage.');
                }
            } catch (error) {
                console.error(`[${SCRIPT_NAME}] ApiHandler: Error reading auth tokens from localStorage:`, error);
                this.uiManager.addChatMessage(`Lỗi đọc token xác thực từ bộ nhớ.`, true, 'color: #e74c3c;');
            }
            this.uiManager.updateTokenStatusUI();
            this.logger.log('ApiHandler: Finished getting auth tokens from localStorage.');
        }

        getApiHeaders() {
            this.logger.log('ApiHandler: Generating API headers.');
            const headers = {
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.state.AUTHTOKENS.idToken}`,
                'ids': '1'
            };
            if (this.state.AUTHTOKENS['Cf-JWT']) {
                headers['cf-jwt'] = this.state.AUTHTOKENS['Cf-JWT'];
                this.logger.log('ApiHandler: Cf-JWT found in headers.');
            } else {
                this.logger.log('ApiHandler: Cf-JWT not found for headers.');
            }
            return headers;
        }

        fetchPlayerData() {
            this.logger.log('ApiHandler: Fetching player data (API #1 - meAndCheckAppVersion) started...');
            let $fetchingMsg = $('#fetching-player-data-msg');
            if ($fetchingMsg.length === 0) {
                this.uiManager.addChatMessage('<p id="fetching-player-data-msg">Đang tải dữ liệu người chơi...</p>');
                $fetchingMsg = $('#fetching-player-data-msg');
            } else {
                $fetchingMsg.text('Đang tải dữ liệu người chơi...');
            }

            if (!this.state.AUTHTOKENS.idToken) {
                this.logger.log('ApiHandler: Cannot fetch player data: idToken is missing.');
                this.uiManager.addChatMessage('Không thể lấy: Thiếu ID Token.', true, 'color: #e74c3c;');
                $fetchingMsg.remove();
                return Promise.reject('ID Token missing');
            }

            const payload = {
                versionNumber: 1, platform: "web",
                fcmToken: "c0RgWZvA5ZZoKAPRSBtX4B:APA91bEjm5d8SDNTJrAgsp53qSpRy2sM9NfmfExvy53osr1yh0JeUsOqV8gNQYdoGHwo1Sds91l00cbkYI6FUb_Hv5yZQKn4MOQksbP8tWwa4RhGJa-H0A",
                locale: "en"
            };
            const requestHeaders = this.getApiHeaders();
            requestHeaders['content-type'] = 'application/json';
            this.logger.log('ApiHandler: Player data fetch request config:', { url: 'https://core.api-wolvesville.com/players/meAndCheckAppVersion', headers: requestHeaders, data: payload });


            return new Promise((resolve, reject) => {
                GM_xmlhttpRequest({
                    method: 'PUT',
                    url: 'https://core.api-wolvesville.com/players/meAndCheckAppVersion',
                    headers: requestHeaders,
                    data: JSON.stringify(payload),
                    onload: (response) => {
                        this.logger.log(`ApiHandler: Player data fetch response received. Status: ${response.status}.`);
                        try {
                            const data = JSON.parse(response.responseText);
                            this.logger.log('ApiHandler: Player data received (API #1):', data);
                            if (data && data.player) {
                                this.state.PLAYER = { ...data.player, isAlive: true };
                                this.uiManager.addChatMessage(`Đã cập nhật dữ liệu người chơi: ${this.state.PLAYER.username} (Lvl ${this.state.PLAYER.level})`, false, 'color: #2ecc71');
                                if (this.state.PLAYER && typeof this.state.PLAYER.xpTotal !== 'undefined' && typeof this.state.PLAYER.level !== 'undefined') {
                                    const xpNeededForLevelUp = this.state.PLAYER.xpUntilNextLevel || (this.state.getXpForNextLevel(this.state.PLAYER.level, this.state.PLAYER.xpTotal).xpNeeded);
                                    const xpForNextLevelCap = this.state.PLAYER.xpTotal + xpNeededForLevelUp;

                                    if (xpNeededForLevelUp > 0) {
                                        this.uiManager.addChatMessage(`Tổng XP: ${this.state.PLAYER.xpTotal} (Lvl ${this.state.PLAYER.level})`, false, 'color: #d0d0d0;');
                                        this.uiManager.addChatMessage(`XP cần để lên Lv ${this.state.PLAYER.level + 1}: ${xpNeededForLevelUp}`, false, 'color: #a2c8ed;');
                                    } else {
                                        this.uiManager.addChatMessage(`Tổng XP: ${this.state.PLAYER.xpTotal} (Lvl ${this.state.PLAYER.level})`, false, 'color: #d0d0d0;');
                                        this.uiManager.addChatMessage(`Bạn đã đạt Lv ${this.state.PLAYER.level}!`, false, 'color: #a2edc2;');
                                    }
                                } else {
                                    this.uiManager.addChatMessage('Không thể tính XP cần (Bot): Dữ liệu người chơi (cấp/tổng XP) vẫn thiếu sau khi cập nhật.', true, 'color: #e74c3c;');
                                }
                                $fetchingMsg.remove();
                                this.logger.log('ApiHandler: Player data updated in StateManager.', this.state.PLAYER);
                                resolve();
                            } else {
                                throw new Error('Player data not found in response (API #1).');
                            }
                        } catch (e) {
                            console.error(`[${SCRIPT_NAME}] ApiHandler: Error parsing player data (API #1):`, e, response.responseText);
                            this.uiManager.addChatMessage(`Lỗi phân tích dữ liệu người chơi (API #1). Trạng thái: ${response.status}.`, true, 'color: #e74c3c;');
                            $fetchingMsg.remove();
                            reject(e);
                        }
                    },
                    onerror: (error) => {
                        console.error(`[${SCRIPT_NAME}] ApiHandler: Error fetching player data (API #1):`, error);
                        this.uiManager.addChatMessage('Lỗi tải dữ liệu người chơi (API #1). Vui lòng kiểm tra mạng hoặc token.', true, 'color: #e74c3c;');
                        $fetchingMsg.remove();
                        reject(error);
                    }
                });
            });
        }

        fetchGameSettings(gameIdForApi) {
            this.logger.log(`ApiHandler: Fetching game settings for gameId: ${gameIdForApi}...`);
            if (!this.state.AUTHTOKENS.idToken || !gameIdForApi) {
                this.logger.log('ApiHandler: Cannot fetch game settings: idToken or gameId missing.', {hasToken: !!this.state.AUTHTOKENS.idToken, gameIdForApi});
                this.uiManager.addChatMessage('Không thể tải cài đặt game: Thiếu Token hoặc ID Game.', true, 'color: #e74c3c;');
                return;
            }

            GM_xmlhttpRequest({
                method: 'GET',
                url: `https://game-asia.api-wolvesville.com/api/public/game/custom/settings?gameId=${gameIdForApi}`,
                headers: this.getApiHeaders(),
                onload: (response) => {
                    this.logger.log(`ApiHandler: Game settings fetch response received. Status: ${response.status}.`);
                    try {
                        const data = JSON.parse(response.responseText);
                        this.logger.log('ApiHandler: Game settings received (API #3):', data);
                        if (data) {
                            this.state.CURRENT_GAME.settings = data;
                            this.uiManager.addChatMessage('Đã tải cài đặt game qua API.', false, 'color: #3498db;');
                            this.socketHandler.checkAndStartAutoPlay();
                            this.logger.log('ApiHandler: Game settings updated in StateManager. AutoPlay check initiated.');
                        } else {
                            throw new Error('Game settings data not found in response (API #3).');
                        }
                    } catch (e) {
                        console.error(`[${SCRIPT_NAME}] ApiHandler: Error parsing game settings (API #3):`, e, response.responseText);
                        this.uiManager.addChatMessage(`Lỗi phân tích cài đặt game (API #3). Trạng thái: ${response.status}.`, true, 'color: #e74c3c;');
                    }
                },
                onerror: (error) => {
                    console.error(`[${SCRIPT_NAME}] ApiHandler: Error fetching game settings (API #3):`, error);
                    this.uiManager.addChatMessage('Lỗi tải cài đặt game (API #3).', true, 'color: #e74c3c;');
                }
            });
        }

        interceptCloudflareJWT() {
            this.logger.log('ApiHandler: Setting up Cloudflare JWT fetch interceptor.');
            const originalFetch = unsafeWindow.fetch;
            unsafeWindow.fetch = async (...args) => {
                const url = args[0] instanceof Request ? args[0].url : args[0];
                const method = args[0] instanceof Request ? args[0].method : (args[1] ? args[1].method : 'GET');

                if (url === 'https://auth.api-wolvesville.com/cloudflareTurnstile/verify' && method.toUpperCase() === 'POST') {
                    this.logger.log('ApiHandler: Intercepting /cloudflareTurnstile/verify for Cf-JWT (POST request).');
                    try {
                        const response = await originalFetch(...args);
                        const clonedResponse = response.clone();
                        const data = await clonedResponse.json();
                        if (data && data.jwt) {
                            this.state.AUTHTOKENS['Cf-JWT'] = data.jwt;
                            this.logger.log('ApiHandler: Cf-JWT intercepted and stored.', { CfJWT_status: this.state.AUTHTOKENS['Cf-JWT'] ? 'Success' : 'Failed', JWT_value_start: this.state.AUTHTOKENS['Cf-JWT'] ? this.state.AUTHTOKENS['Cf-JWT'].substring(0, 10) + '...' : 'N/A' });
                            this.uiManager.updateTokenStatusUI();
                            this.uiManager.addChatMessage('🛡️ Token Cloudflare (Cf-JWT) đã chặn', true, 'color: #8e44ad;');
                        } else {
                             this.logger.log('ApiHandler: Cf-JWT not found in response from /cloudflareTurnstile/verify.', data);
                        }
                        return response;
                    } catch (err) {
                        console.error(`[${SCRIPT_NAME}] ApiHandler: Error intercepting ${url}:`, err);
                        this.logger.log(`ApiHandler: Error during Cf-JWT interception: ${err.message}`, err);
                        return originalFetch(...args);
                    }
                }
                return originalFetch(...args);
            };
            this.logger.log('ApiHandler: Cloudflare JWT fetch interceptor set up.');
        }
    }

    class GameLogic {
        constructor(stateManager, logger) {
            this.state = stateManager;
            this.logger = logger;
            this.uiManager = null;
            this.socketHandler = null;
            this.logger.log(`GameLogic initialized.`);
        }

        setDependencies(uiManager, socketHandler) {
            this.uiManager = uiManager;
            this.socketHandler = socketHandler;
            this.logger.log('GameLogic: Dependencies (UiManager, SocketHandler) set.');
        }

        handleWerewolfNightAction() {
            this.logger.log('GameLogic: Entering handleWerewolfNightAction (New Logic).');
            const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);
            if (cRD && cRD.team === 'WEREWOLF') {
                this.logger.log('GameLogic: Player is a Werewolf. Checking for non-werewolf lover to vote.');
                const lover = this.state.CURRENT_GAME.lovers.find(lv => {
                    const loverRole = this.state.getRoleById(lv.role);
                    this.logger.log(`DEBUG Lover Check (Vote): Lover ID: ${lv.id}, Lover Role Data:`, { lvRole: lv.role, resolvedRole: loverRole, isWerewolfTeam: loverRole?.team === 'WEREWOLF' });
                    return loverRole && loverRole.team !== 'WEREWOLF';
                });

                if (lover) {
                    const targetPlayer = this.state.CURRENT_GAME.players.find(p => p.id === lover.id);
                    if (targetPlayer && targetPlayer.isAlive) {
                        const loverRoleDefinition = this.state.getRoleById(lover.role);
                        if (cRD.id !== 'junior-werewolf' && ['priest', 'vigilante', 'gunner'].includes(loverRoleDefinition?.id)) {
                            this.logger.log(`GameLogic: Found non-werewolf lover (${targetPlayer.username}) who is a ${loverRoleDefinition.name}. Skipping bite for Werewolf.`);
                            this.uiManager.addChatMessage(`🚫 WW (Bot): Bỏ qua cắn người yêu ${targetPlayer.username} (${loverRoleDefinition.name}).`, false, 'color: #ff9800;');
                            return;
                        }
                        this.logger.log(`GameLogic: Found non-werewolf lover to vote: ${targetPlayer.username}. Emitting vote.`);
                        this.uiManager.addChatMessage(`👉 WW Vote (Người yêu): ${targetPlayer.gridIdx + 1}. ${targetPlayer.username}`, false, 'color: #FF5722;');

                        if (this.state.CUSTOM_GAME_SOCKET && !this.state.CUSTOM_GAME_SOCKET.disconnected) {
                            this.state.CUSTOM_GAME_SOCKET.emit('game-werewolves-vote-set', JSON.stringify({ targetPlayerId: lover.id }));
                            this.state.CURRENT_GAME.targetWerewolfVote = lover.id;
                        } else {
                            this.logger.log('GameLogic: CUSTOM_GAME_SOCKET not connected. Cannot send vote.');
                        }
                    }
                } else {
                    this.logger.log('GameLogic: No non-werewolf lover found. No proactive action taken.');
                }
            }
             this.logger.log('GameLogic: Exiting handleWerewolfNightAction (New Logic).');
        }

		handleJuniorWerewolfNightAction() {
            this.logger.log('GameLogic: Entering handleJuniorWerewolfNightAction (New Logic).');
            this.handleWerewolfNightAction();
            this.logger.log('GameLogic: Junior Werewolf action delegated to standard werewolf night action. Listening for team commands.');
        }

        handleDayVote() {
            this.logger.log('GameLogic: Entering handleDayVote.');
            if (this.state.PLAYER && !this.state.CURRENT_GAME.deads.includes(this.state.PLAYER.id)) {
                this.logger.log('GameLogic: Player is alive for day vote.');
                const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);
                const wwL = this.state.CURRENT_GAME.lovers.find(l => {
                    const lr = this.state.getRoleById(l.role);
                    return lr && lr.team === 'WEREWOLF';
                });

                if (!this.state.CUSTOM_GAME_SOCKET || this.state.CUSTOM_GAME_SOCKET.disconnected) {
                     this.logger.log('GameLogic: CUSTOM_GAME_SOCKET is not connected. Cannot send day vote action.');
                     this.uiManager.addChatMessage('Bot socket not connected. Cannot send day vote.', false, 'color: #e74c3c;');
                     return;
                }

                if (wwL) {
                    this.logger.log(`GameLogic: Found Werewolf lover: ${wwL.id}.`);
                    const tP = this.state.CURRENT_GAME.players.find(v => v.id === wwL.id);
                    if (tP && !this.state.CURRENT_GAME.deads.includes(tP.id)) {
                        if (cRD && cRD.team === 'WEREWOLF') {
                            this.logger.log('GameLogic: Player is Werewolf, sending "wc" public chat.');
                            this.state.CUSTOM_GAME_SOCKET.emit('game:chat-public:msg', JSON.stringify({ msg: 'wc' }));
                        }
                        this.uiManager.addChatMessage(`👉 Day Vote (WW Lover): ${tP.gridIdx + 1}. ${tP.username}`);
                        this.state.CUSTOM_GAME_SOCKET.emit('game-day-vote-set', JSON.stringify({ targetPlayerId: wwL.id }));
                        this.logger.log(`GameLogic: Voted for WW lover: ${tP.username} (${tP.id}).`);
                    } else {
                        this.logger.log('GameLogic: WW lover not found or already dead for day vote.');
                    }
                }
                else if (cRD && cRD.team === 'WEREWOLF') {
                    this.logger.log('GameLogic: Player is Werewolf (no WW lover), sending "me" public chat.');
                    this.state.CUSTOM_GAME_SOCKET.emit('game:chat-public:msg', JSON.stringify({ msg: 'me' }));
                    this.uiManager.addChatMessage('💬 Public: Đã gửi "me".', false, 'color: #3498db;');
                }
                else if (cRD && ['serial-killer', 'arsonist', 'corruptor', 'bandit', 'cannibal', 'evil-detective', 'bomber', 'alchemist', 'siren', 'illusionist', 'blight', 'sect-leader', 'zombie'].includes(cRD.id)) {
                    this.logger.log(`GameLogic: Player is a Solo role (${cRD.id}), sending "solo" public chat.`);
                    this.state.CUSTOM_GAME_SOCKET.emit('game:chat-public:msg', JSON.stringify({ msg: 'solo' }));
                    this.uiManager.addChatMessage('💬 Public: Đã gửi "solo".', false, 'color: #3498db;');
                } else {
                    this.logger.log('GameLogic: Player is not a predefined role for automatic day vote (or already dead).');
                }
            } else {
                this.logger.log('GameLogic: Player is dead, skipping day vote.');
            }
            this.logger.log('GameLogic: Exiting handleDayVote.');
        }

        handlePublicChatVote(data) {
            this.logger.log('GameLogic: Entering handlePublicChatVote.', { rawData: data });
            const d = JSON.parse(data);
            this.logger.log('GameLogic: Parsed public chat data:', d);

            if (this.state.PLAYER && !this.state.CURRENT_GAME.deads.includes(this.state.PLAYER.id) && d.authorId !== this.state.PLAYER.id && d.msg) {
                this.logger.log('GameLogic: Public chat is from another player and player is alive. Checking role and message.');
                const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);
                if (cRD && cRD.team === 'VILLAGER' && ['Me', 'me', 'ME', 'm', 'M', 'wc', 'Wc', 'WC'].includes(d.msg)) {
                    this.logger.log(`GameLogic: Player is Villager, chat message is '${d.msg}'. Attempting to follow vote.`);
                    const tP = this.state.CURRENT_GAME.players.find(v => v.id === d.authorId);
                    if (tP && !this.state.CURRENT_GAME.deads.includes(tP.id)) {
                        this.uiManager.addChatMessage(`👉 Day Vote (following chat '${d.msg}'): ${tP.gridIdx + 1}. ${tP.username}`);
                        if (!this.state.CUSTOM_GAME_SOCKET || this.state.CUSTOM_GAME_SOCKET.disconnected) {
                             this.logger.log('GameLogic: CUSTOM_GAME_SOCKET is not connected. Cannot send public chat vote action.');
                             this.uiManager.addChatMessage('Bot socket not connected. Cannot follow public chat vote.', false, 'color: #e74c3c;');
                             return;
                        }
                        this.state.CUSTOM_GAME_SOCKET.emit('game-day-vote-set', JSON.stringify({ targetPlayerId: tP.id }));
                        this.logger.log(`GameLogic: Voted for ${tP.username} (${tP.id}) based on public chat.`);
                    } else {
                        this.logger.log('GameLogic: Target player for public chat vote not found or already dead.');
                    }
                } else {
                    this.logger.log('GameLogic: Player is not Villager or chat message is not a recognized vote command.');
                }
            } else {
                this.logger.log('GameLogic: Skipping public chat vote logic (player dead, self-chat, or no message).');
            }
            this.logger.log('GameLogic: Exiting handlePublicChatVote.');
        }

        handleDayKillSkills(data) {
            this.logger.log('GameLogic: Entering handleDayKillSkills.', { rawData: data });
            const d = JSON.parse(data);
            this.logger.log('GameLogic: Parsed day vote set data:', d);

            if (this.state.PLAYER && !this.state.CURRENT_GAME.deads.includes(this.state.PLAYER.id)) {
                this.logger.log('GameLogic: Player is alive. Checking for kill skills.');
                const tP = this.state.CURRENT_GAME.players.find(v => v.id === d.targetPlayerId);
                const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);

                if (!this.state.CUSTOM_GAME_SOCKET || this.state.CUSTOM_GAME_SOCKET.disconnected) {
                     this.logger.log('GameLogic: CUSTOM_GAME_SOCKET is not connected. Cannot send day kill skill action.');
                     this.uiManager.addChatMessage('Bot socket not connected. Cannot use day kill skill.', false, 'color: #e74c3c;');
                     return;
                }

                if (cRD && tP && !this.state.CURRENT_GAME.deads.includes(tP.id)) {
                    this.logger.log(`GameLogic: Player role: ${cRD.id}, Target player: ${tP.username} (${tP.id}).`);
                    if (cRD.id === 'priest') {
                        this.logger.log('GameLogic: Player is Priest. Scheduling priest kill.');
                        setTimeout(() => {
                            this.uiManager.addChatMessage(`💦 Priest giết (từ vote ngày): ${tP.gridIdx + 1}. ${tP.username}`);
                            this.state.CUSTOM_GAME_SOCKET.emit('game-priest-kill-player', JSON.stringify({ targetPlayerId: d.targetPlayerId }));
                            this.logger.log(`GameLogic: Priest killed ${tP.username}.`);
                        }, 1000 + Math.random() * 500);
                    } else if (cRD.id === 'vigilante') {
                        this.logger.log('GameLogic: Player is Vigilante. Scheduling vigilante shoot.');
                        setTimeout(() => {
                            this.uiManager.addChatMessage(`🔫 Vigilante bắn (từ vote ngày): ${tP.gridIdx + 1}. ${tP.username}`);
                            this.state.CUSTOM_GAME_SOCKET.emit('game-vigilante-shoot', JSON.stringify({ targetPlayerId: d.targetPlayerId }));
                            this.logger.log(`GameLogic: Vigilante shot ${tP.username}.`);
                        }, 1000 + Math.random() * 500);
                    } else if (cRD.id === 'gunner') {
                        this.logger.log('GameLogic: Player is Gunner. Scheduling gunner shoot.');
                        setTimeout(() => {
                            this.uiManager.addChatMessage(`🔫 Gunner bắn (từ vote ngày): ${tP.gridIdx + 1}. ${tP.username}`);
                            this.state.CUSTOM_GAME_SOCKET.emit('game-gunner-shoot-player', JSON.stringify({ targetPlayerId: d.targetPlayerId }));
                            this.logger.log(`GameLogic: Gunner shot ${tP.username}.`);
                        }, 1000 + Math.random() * 500);
                    } else {
                        this.logger.log('GameLogic: Player has no automatic day kill skill or target is dead.');
                    }
                } else {
                    this.logger.log('GameLogic: No valid role or target for day kill skill.');
                }
            } else {
                this.logger.log('GameLogic: Player is dead, skipping day kill skill logic.');
            }
            this.logger.log('GameLogic: Exiting handleDayKillSkills.');
        }
    }

    class SocketHandler {
        constructor(stateManager, logger, uiManager, gameLogic, apiHandler) {
            this.state = stateManager;
            this.logger = logger;
            this.uiManager = uiManager;
            this.gameLogic = gameLogic;
            this.apiHandler = apiHandler;
            this.logger.log(`SocketHandler initialized.`);
        }

        mainSocketInterceptor() {
            this.logger.log('SocketHandler: Attempting to set up main game socket interceptor.');
            if (this.state.MAIN_SOCKET_LISTENER_ACTIVE || typeof unsafeWindow.MessageEvent === 'undefined') {
                this.logger.log('SocketHandler: Main socket interceptor already active or MessageEvent not available. Skipping setup.');
                return;
            }
            try {
                let property = Object.getOwnPropertyDescriptor(unsafeWindow.MessageEvent.prototype, 'data');
                const origDataGetter = property.get;
                property.get = function() {
                    const socket = this.currentTarget instanceof unsafeWindow.WebSocket;
                    const msgData = origDataGetter.call(this);
                    if (socket && this.currentTarget.url.includes('wolvesville.com')) {
                        mainController.socketHandler.mainSocketMessageHandler({ data: msgData, socket: this.currentTarget, event: this });
                    }
                    return msgData;
                };
                Object.defineProperty(unsafeWindow.MessageEvent.prototype, 'data', property);
                this.state.MAIN_SOCKET_LISTENER_ACTIVE = true;
                this.logger.log("SocketHandler: Main game socket interceptor set up successfully.");
            } catch (e) {
                console.error(`[${SCRIPT_NAME}] SocketHandler: Error setting up socket interceptor:`, e);
                this.uiManager.addChatMessage('Lỗi thiết lập bộ chặn socket. Chức năng bot có thể bị hạn chế.', true, 'color: #e74c3c;');
            }
        }

        parseSocketMessage(rawMessageData) {
            if (typeof rawMessageData !== 'string' || !rawMessageData.startsWith('42')) {
                return null;
            }
            let tmp = rawMessageData.slice(2);
            try {
                const parsed = JSON.parse(tmp);
                return parsed;
            } catch (e) {
                this.logger.log('SocketHandler: Failed to parse socket message (first attempt), retrying with cleanup.', e);
                try {
                    tmp = tmp.replace(/^"|"$/g, '');
                    tmp = tmp.replace(/\\"/g, '"');
                    tmp = tmp.replace(/\\'{/g, '{');
                    tmp = tmp.replace(/\\}'/g, '}');
                    const parsed = JSON.parse(tmp);
                    return parsed;
                } catch (e2) {
                    this.logger.log('SocketHandler: Failed to parse socket message after retry:', rawMessageData, e2);
                    return null;
                }
            }
        }

        mainSocketMessageHandler({ data: msgData }) {
            const parsedMessage = this.parseSocketMessage(msgData);
            if (parsedMessage && Array.isArray(parsedMessage) && parsedMessage.length > 0) {
                const msgType = parsedMessage[0];
                const msgPayload = parsedMessage.length > 1 ? parsedMessage[1] : null;

                if (this.state.SETTINGS.debugMode && !['player-moved', 'player-stats-updated', 'game-time-sync'].includes(msgType)) {
                }
                const handler = this.mainGameMessagesToCatch[msgType];
                if (handler) {
                    this.logger.log(`SocketHandler: Calling handler for main socket message type: ${msgType}`);
                    handler(msgPayload);
                } else {
                }
            } else if (this.state.SETTINGS.debugMode && typeof msgData === 'string' && !msgData.startsWith("0") && !msgData.startsWith("3")) {
                this.logger.log('[MainSocket UNPARSED/UNKNOWN MSG]', msgData);
            }
        }

        mainGameMessagesToCatch = {
            'game-joined': (data) => {
                this.logger.log('SocketHandler: Caught main socket event: game-joined');
                if (this.state.CUSTOM_GAME_SOCKET) {
                    this.logger.log('SocketHandler: Custom game socket already active, skipping main socket game-joined event.');
                    return;
                }
                this.uiManager.addChatMessage('🔗 🔗 Đã vào game (socket chính)', true, 'color: #3498db;');
                this.logger.log('Main Socket: game-joined RAW PAYLOAD:', data);

                let gameData = typeof data === 'string' ? JSON.parse(data) : data;
                if (gameData.gameId && gameData.serverUrl) {
                    this.state.resetGameState();
                    this.state.CURRENT_GAME.id = gameData.gameId;
                    this.state.CURRENT_GAME.serverUrl = gameData.serverUrl;
                    this.logger.log('Main Socket: game-joined UPDATED STATE:', { GAME_ID: this.state.CURRENT_GAME.id, SERVER_URL: this.state.CURRENT_GAME.serverUrl });
                    this.apiHandler.fetchGameSettings(gameData.gameId);
					sendCommandToPython("stop_autoclick", { gameId: gameData.gameId, reason: "game_joined" }); // Gửi lệnh STOP
                } else {
                    this.logger.log('Main Socket: game-joined PAYLOAD UNEXPECTED FORMAT. DATA:', gameData);
                    this.state.CURRENT_GAME.id = undefined; this.state.CURRENT_GAME.serverUrl = undefined;
                }
            },
            'game-settings-changed': (data) => {
                this.logger.log('SocketHandler: Caught main socket event: game-settings-changed');
                let settingsData = typeof data === 'string' ? JSON.parse(data) : data;
                this.state.CURRENT_GAME.settings = settingsData;
                this.logger.log('Main Socket: game-settings-changed', this.state.CURRENT_GAME.settings);
            },
            'game-starting': () => {
                this.logger.log('SocketHandler: Caught main socket event: game-starting');
                if (this.state.CUSTOM_GAME_SOCKET) {
                     this.logger.log('SocketHandler: Custom game socket already active, skipping main socket game-starting event.');
                     return;
                }
                this.uiManager.addChatMessage('🚩 🚩 Game đang bắt đầu (socket chính)', true, 'color: #e67e22;');
                this.state.CURRENT_GAME.status = 'starting';
                this.logger.log('Main Socket: Game status set to "starting".');
            },
            'game-started': (data) => {
                this.logger.log('SocketHandler: Caught main socket event: game-started');
                if (this.state.CUSTOM_GAME_SOCKET) {
                    this.logger.log('SocketHandler: Custom game socket already active, skipping main socket game-started event.');
                    return;
                }
                this.uiManager.addChatMessage('🚀 🚀 Game đã bắt đầu (socket chính)', true, 'color: #2ecc71;');
                this.state.CURRENT_GAME.status = 'started';
                this.state.CURRENT_GAME.startedAt = new Date().getTime();

                let gameData = typeof data === 'string' ? JSON.parse(data) : data;
                this.state.CURRENT_GAME.role = gameData.roleDefinition || this.state.getRoleById(gameData.role);
                this.state.CURRENT_GAME.players = gameData.players || [];

                this.logger.log('Main Socket: game-started UPDATED STATE:', { ROLE: this.state.CURRENT_GAME.role, PLAYERS_COUNT: this.state.CURRENT_GAME.players.length });
                if(this.state.CURRENT_GAME.role) this.uiManager.addChatMessage(`Bạn là ${this.state.CURRENT_GAME.role.name || this.state.CURRENT_GAME.role.id}`, true, 'color: #FF4081;');

                this.checkAndStartAutoPlay();
            },
            'disconnect': () => {
                this.logger.log('SocketHandler: Caught main socket event: disconnect');
                this.uiManager.addChatMessage('🔌 Socket chính đã ngắt kết nối. Đang xóa trạng thái game.', true, 'color: #e74c3c;');
                this.state.resetGameState();

                if (this.state.CUSTOM_GAME_SOCKET) {
                    this.logger.log('SocketHandler: Main socket disconnected, also disconnecting Bot Socket.');
                    this.state.CUSTOM_GAME_SOCKET.disconnect();
                    this.state.CUSTOM_GAME_SOCKET = undefined;
                    this.uiManager.addChatMessage('🤖 🤖 Bot Socket đã ngắt kết nối.', true, 'color: #e74c3c;');
                }
            },
            'game-over-awards-available': async (data) => {
                this.logger.log('SocketHandler: Caught main socket event: game-over-awards-available');
                const parsedData = typeof data === 'string' ? JSON.parse(data) : data;
                this.uiManager.addChatMessage(`🎉 🎉 Game kết thúc (Socket chính). XP: ${parsedData.playerAward.awardedTotalXp}`, true, 'color:#f1c40f;');

                this.logger.log('Main Socket DEBUG: game-over-awards-available - PLAYER object (before fetch):', this.state.PLAYER);
                this.logger.log('Main Socket DEBUG: game-over-awards-available - parsedData.playerAward:', parsedData.playerAward);

                this.state.GAME_COUNT_FOR_REFRESH++;
                this.logger.log(`SocketHandler: Game over. Current game count for refresh: ${this.state.GAME_COUNT_FOR_REFRESH}`);
                await GM_setValue('gameCountForRefresh', this.state.GAME_COUNT_FOR_REFRESH);

                if (this.state.GAME_COUNT_FOR_REFRESH >= 3) {
                    this.logger.log('SocketHandler: Game count reached 3. Triggering token refresh and resetting counter.');
                    this.apiHandler.getAuthTokensFromLocalStorage();
                    this.uiManager.addChatMessage('Token tự động làm mới sau 3 ván game.', false, 'color: #3498db;');
                    this.state.GAME_COUNT_FOR_REFRESH = 0;
                    await GM_setValue('gameCountForRefresh', this.state.GAME_COUNT_FOR_REFRESH);
                } else {
                    this.logger.log(`SocketHandler: Token refresh skipped. Next refresh in ${3 - this.state.GAME_COUNT_FOR_REFRESH} games.`);
                    this.uiManager.addChatMessage(`Token sẽ làm mới sau ${3 - this.state.GAME_COUNT_FOR_REFRESH} ván nữa.`, false, 'color: #bdc3c7;');
                }

                this.state.IS_GAME_OVER = true;
				sendCommandToPython("start_autoclick", { gameId: this.state.CURRENT_GAME.id, reason: "game_over" }); // Gửi lệnh START

                if (this.state.CUSTOM_GAME_SOCKET) {
                    this.logger.log('SocketHandler: Game over, disconnecting Bot Socket.');
                    this.state.CUSTOM_GAME_SOCKET.disconnect();
                    this.state.CUSTOM_GAME_SOCKET = undefined;
                    this.uiManager.addChatMessage('🤖 Bot Socket đã ngắt kết nối.', true, 'color: #e74c3c;');
                }
            }
        };

        checkAndStartAutoPlay() {
            this.logger.log('SocketHandler: Checking conditions to start Auto Play Custom Cupid...');
            const conditions = {
                autoPlayEnabled: this.state.SETTINGS.autoPlayCustomCupidEnabled,
                botSocketConnected: !!this.state.CUSTOM_GAME_SOCKET,
                gameId: !!this.state.CURRENT_GAME.id,
                serverUrl: !!this.state.CURRENT_GAME.serverUrl,
                idToken: !!this.state.AUTHTOKENS.idToken,
                cfJwt: !!this.state.AUTHTOKENS['Cf-JWT'],
                playerData: !!this.state.PLAYER,
                playerAlive: this.state.PLAYER?.isAlive,
                roleData: !!this.state.CURRENT_GAME.role,
                gameSettings: !!this.state.CURRENT_GAME.settings,
                gameModeCustom: this.state.CURRENT_GAME.settings?.gameMode === 'custom',
                allCoupled: this.state.CURRENT_GAME.settings?.allCoupled
            };
            this.logger.log('SocketHandler: AutoPlay conditions:', conditions);

            if (conditions.autoPlayEnabled &&
                !conditions.botSocketConnected &&
                conditions.gameId && conditions.serverUrl && conditions.idToken && conditions.cfJwt &&
                conditions.playerData && conditions.playerAlive && conditions.roleData &&
                conditions.gameSettings && conditions.gameModeCustom && conditions.allCoupled
            ) {
                this.logger.log('SocketHandler: All conditions met for Auto Play Custom Cupid. Attempting to connect bot socket...');
                this.uiManager.addChatMessage('🤖 Đủ điều kiện để tự động chơi. Đang kết nối bot socket...', true, 'color: #8e44ad;');
                this.connectCustomGameSocket();
            } else if (conditions.autoPlayEnabled && !conditions.botSocketConnected) {
                const reasons = [];
                if(!conditions.gameId) reasons.push("GAME_ID");
                if(!conditions.serverUrl) reasons.push("SERVER_URL");
                if(!conditions.idToken) reasons.push("idToken"); if(!conditions.cfJwt) reasons.push("Cf-JWT");
                if(!conditions.playerData) reasons.push("PLAYER data"); else if (!conditions.playerAlive) reasons.push("PLAYER not alive");
                if(!conditions.roleData) reasons.push("ROLE data");
                if(!conditions.gameSettings) reasons.push("GAME_SETTINGS");
                else { if(!conditions.gameModeCustom) reasons.push(`GameMode not custom (is ${this.state.CURRENT_GAME.settings.gameMode})`);
                       if(!conditions.allCoupled) reasons.push("Not allCoupled"); }
                if(reasons.length > 0) this.logger.log(`SocketHandler: AutoPlay: Waiting for missing conditions: ${reasons.join(', ')}.`);
            } else {
                 this.logger.log('SocketHandler: AutoPlay is disabled or bot socket already connected.');
            }
        }

        connectCustomGameSocket() {
            this.logger.log('SocketHandler: Attempting to connect custom game socket...');
            const targetGameId = this.state.CURRENT_GAME.id;

            if (this.state.CUSTOM_GAME_SOCKET || !targetGameId || !this.state.CURRENT_GAME.serverUrl || !this.state.AUTHTOKENS.idToken || !this.state.AUTHTOKENS['Cf-JWT'] || !this.state.PLAYER || !this.state.PLAYER.isAlive || !this.state.CURRENT_GAME.role) {
                this.logger.log('SocketHandler: Cannot connect custom game socket: Missing critical information.', { hasSocket: !!this.state.CUSTOM_GAME_SOCKET, GAME_ID: targetGameId, SERVER_URL: this.state.CURRENT_GAME.serverUrl, idToken: !!this.state.AUTHTOKENS.idToken, CfJWT: !!this.state.AUTHTOKENS['Cf-JWT'], PLAYER: !!this.state.PLAYER, PLAYER_ALIVE: this.state.PLAYER?.isAlive, ROLE: !!this.state.CURRENT_GAME.role });
                this.uiManager.addChatMessage('Không thể kết nối bot: Thiếu thông tin game/người chơi hoặc token.', true, 'color: #e74c3c;');
                return;
            }

            this.logger.log('SocketHandler: Resetting game-specific state before custom socket connection.');
            this.state.CURRENT_GAME.lovers = [];
            this.state.CURRENT_GAME.deads = [];
            this.state.CURRENT_GAME.juniorWerewolfTarget = undefined;
            this.state.CURRENT_GAME.werewolfNightActionSent = false;
            this.state.CURRENT_GAME.werewolves = [];
            this.state.CURRENT_GAME.targetWerewolfVote = undefined;
            this.state.CURRENT_GAME.loverAnnounced = false;

            const botSocketUrl = `wss://${this.state.CURRENT_GAME.serverUrl.replace('https://', '').replace(/:\d+$/, '')}/`;
            this.logger.log(`SocketHandler: Connecting bot socket to ${botSocketUrl} for game ${targetGameId}`);
            this.uiManager.addChatMessage(`🤖 Đang kết nối bot tới: ${botSocketUrl}`, false, 'color: #f39c12;');
            this.state.CUSTOM_GAME_SOCKET = io(botSocketUrl, { query: { firebaseToken: this.state.AUTHTOKENS.idToken, gameId: targetGameId, reconnect: true, ids: 1, 'Cf-JWT': this.state.AUTHTOKENS['Cf-JWT'], apiV: 1, EIO: 4, }, transports: ['websocket'], });

            this.logger.log('SocketHandler: Setting up custom game socket event listeners.');
            this.state.CUSTOM_GAME_SOCKET.on('disconnect', (reason) => {
                this.uiManager.addChatMessage(`🤖 Bot Socket đã ngắt kết nối: ${reason}`, true, 'color: #e74c3c;');
                this.logger.log('Bot Socket đã ngắt kết nối:', reason);
                this.state.CUSTOM_GAME_SOCKET = undefined;
            });
            this.state.CUSTOM_GAME_SOCKET.on('connect_error', (err) => {
                this.uiManager.addChatMessage(`🤖 Lỗi kết nối Bot Socket: ${err.message}`, true, 'color: #e74c3c;');
                this.logger.log('Lỗi kết nối Bot Socket:', err);
                this.state.CUSTOM_GAME_SOCKET = undefined;
            });
            this.state.CUSTOM_GAME_SOCKET.on('connect', () => {
                this.logger.log('Bot socket: CONNECTED!');
            });
            this.state.CUSTOM_GAME_SOCKET.on('game-joined', () => {
                this.uiManager.addChatMessage(`🤖 Bot Socket đã kết nối và vào game!`, true, 'color: #27ae60;');
                this.logger.log('Bot socket: game-joined event received.');
            });
            this.state.CUSTOM_GAME_SOCKET.on('game-players-killed', (_data) => {
                this.logger.log('Bot socket: game-players-killed event received.', _data);
                const d=JSON.parse(_data);
                d.victims.forEach(v=>{
                    const p=this.state.CURRENT_GAME.players.find(pl=>pl.id===v.targetPlayerId);
                    if(p){
                        if(!this.state.CURRENT_GAME.deads.includes(p.id)) this.state.CURRENT_GAME.deads.push(p.id);
                        this.uiManager.addChatMessage(`☠️ ${p.gridIdx+1}. ${p.username} (${v.targetPlayerRole}) by ${v.targetPlayerId === this.state.PLAYER.id ? 'LOVER' : v.cause}`);
                        this.logger.log(`Bot socket: Player đã bị giết: ${p.username} (${v.targetPlayerRole}), Cause: ${v.cause}`);
                        if (this.state.PLAYER && p.id === this.state.PLAYER.id) {
                            this.state.PLAYER.isAlive = false;
                            this.logger.log(`Bot socket: Player status updated to dead.`);
                        }
                    }
                });
            });
            this.state.CUSTOM_GAME_SOCKET.on('game-cupid-lover-ids-and-roles', (_data) => {
                this.logger.log('Bot socket: game-cupid-lover-ids-and-roles event received.', _data);
                const d=JSON.parse(_data);
                this.logger.log(`DEBUG: d.loverPlayerIds:`, d.loverPlayerIds);
                this.logger.log(`DEBUG: d.loverRoles:`, d.loverRoles);

                if(this.state.PLAYER && this.state.CURRENT_GAME.role){
                    this.state.CURRENT_GAME.lovers = d.loverPlayerIds.map((pId, index) => {
                        const roleId = d.loverRoles[index];
                        return { id: pId, role: roleId };
                    }).filter(lover => lover.id !== this.state.PLAYER.id);

                    this.logger.log('Bot socket: Lovers updated:', this.state.CURRENT_GAME.lovers);

                    if(this.state.CURRENT_GAME.lovers.length === 1){
                        const l1=this.state.CURRENT_GAME.players.find(v=>v.id===this.state.CURRENT_GAME.lovers[0].id);
                        if(l1) this.uiManager.addChatMessage(`💘 Người yêu của bạn là ${l1.gridIdx+1}. ${l1.username} (${this.state.getRoleById(this.state.CURRENT_GAME.lovers[0].role)?.name||this.state.CURRENT_GAME.lovers[0].role})`);
                        this.logger.log(`Bot socket: Displayed lover info for ${l1?.username}.`);
                    } else if (this.state.CURRENT_GAME.lovers.length > 1) {
                        this.uiManager.addChatMessage(`💘 Bạn có ${this.state.CURRENT_GAME.lovers.length} lovers.`, false, 'color: #FFC0CB;');
                    }

                    const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);
                    if (cRD && cRD.team === 'WEREWOLF' && cRD.id !== 'junior-werewolf') {
                        if (!this.state.CURRENT_GAME.loverAnnounced) {
                            this.logger.log('Bot socket: Normal WW - Preparing to announce non-werewolf lover AFTER LOVER DATA IS READY.');
                            const loverToAnnounce = this.state.CURRENT_GAME.lovers.find(lv => {
                                const loverRole = this.state.getRoleById(lv.role);
                                this.logger.log(`DEBUG Lover Check (Announce): Lover ID: ${lv.id}, Lover Role Data:`, { lvRole: lv.role, resolvedRole: loverRole, isWerewolfTeam: loverRole?.team === 'WEREWOLF' });
                                return loverRole && loverRole.team !== 'WEREWOLF';
                            });

                            if (loverToAnnounce) {
                                const loverPlayer = this.state.CURRENT_GAME.players.find(p => p.id === loverToAnnounce.id);
                                const loverRoleName = this.state.getRoleById(loverToAnnounce.role)?.name || loverToAnnounce.role;
                                this.logger.log(`DEBUG Found Lover to Announce: ${loverPlayer?.username} (${loverRoleName})`);

                                if (loverPlayer) {
                                    const KhaiLove = `Cpl ${loverPlayer.gridIdx + 1} ${loverRoleName}`;
                                    setTimeout(() => {
                                        this.state.CUSTOM_GAME_SOCKET.emit("game:chat-werewolves:msg", JSON.stringify({ msg: KhaiLove }));
                                        this.uiManager.addChatMessage(`💬 WW: Đã gửi love: ${KhaiLove}.`, false, 'color: #FF5722;');
                                        this.state.CURRENT_GAME.loverAnnounced = true;
                                    }, 1000 + Math.random() * 1000);
                                }
                            } else {
                                this.logger.log('Bot socket: No non-werewolf lover found to announce (after lover data ready).');
                            }
                        } else {
                            this.logger.log('Bot socket: Lover already announced for this game. Skipping.');
                        }
                    }

                    setTimeout(() => {
                        this.logger.log('Bot socket: Executing night actions after lover data and delay.');
                        this.gameLogic.handleWerewolfNightAction();
                    }, 1000 + Math.random() * 500);

                } else {
                    this.logger.log('Bot socket: Player or Current Role not defined for lover info.');
                }
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-night-started', () => {
                this.logger.log('Bot socket: Caught game-night-started event. Resetting night flags.');
                this.uiManager.addChatMessage('🌙 Đêm đã bắt đầu (Bot).');
                this.state.CURRENT_GAME.werewolfNightActionSent = false;
                const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);
                if (cRD && cRD.id === 'junior-werewolf') {
                    setTimeout(() => {
                        if (this.state.CUSTOM_GAME_SOCKET && !this.state.CUSTOM_GAME_SOCKET.disconnected) {
                            this.state.CUSTOM_GAME_SOCKET.emit("game:chat-werewolves:msg", JSON.stringify({ msg: 'Who?' }));
                            this.uiManager.addChatMessage(`💬 Sói con (Bot): Đã gửi "Who?" vào chat sói.`, false, 'color: #7B68EE;');
                            this.logger.log('Bot socket: Junior Werewolf sent "Who?" to werewolf chat.');
                        }
                    }, 500 + Math.random() * 500);
                }
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-day-started', () => {
                this.logger.log('Bot socket: Caught game-day-started event. Resetting night flags.');
                this.uiManager.addChatMessage('☀️ Ngày đã bắt đầu (Bot).');
                this.state.CURRENT_GAME.werewolfNightActionSent = false;
                this.state.CURRENT_GAME.juniorWerewolfTarget = undefined;
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-werewolves-set-roles', (_data) => {
                this.logger.log('Bot socket: Caught game-werewolves-set-roles event.', _data);
                const d = JSON.parse(_data);
                this.state.CURRENT_GAME.werewolves = Object.entries(d.werewolves).map(([id, role]) => ({ id, role }));
                this.logger.log('Bot: WW roles set:', this.state.CURRENT_GAME.werewolves);
            });

            this.state.CUSTOM_GAME_SOCKET.on('game:chat-werewolves:msg', (_data) => {
                this.logger.log('Bot socket: Caught game:chat-werewolves:msg event (New Logic).', _data);
                const d = JSON.parse(_data);
                this.logger.log('Bot WW Chat MSG:', d);

                this.state.CURRENT_GAME.chatMessages.push({ chat: "werewolf", senderPlayerId: d.authorId, text: d.msg, timestamp: new Date().getTime() });
                if (this.state.CURRENT_GAME.chatMessages.length > MAX_CHAT_MESSAGES) {
                    this.state.CURRENT_GAME.chatMessages.shift();
                }

                const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);

                if (cRD && cRD.id === 'junior-werewolf' && d.msg && d.authorId !== this.state.PLAYER.id) {
                    this.logger.log('Bot socket: JW - Processing werewolf chat for target detection.');
                    const n = d.msg.match(/\d+/);
                    if (n && n.length) {
                        const gI = parseInt(n[0]);
                        const tP = this.state.CURRENT_GAME.players.find(v => v.gridIdx + 1 === gI);
						if (tP && !this.state.CURRENT_GAME.deads.includes(tP.id)) {
							this.state.CURRENT_GAME.juniorWerewolfTarget = tP.id;
							this.uiManager.addChatMessage(`🐾 Mục tiêu Sói con (từ chat): ${tP.gridIdx + 1}. ${tP.username}`);
							this.state.CUSTOM_GAME_SOCKET.emit('game-junior-werewolf-selected-player', JSON.stringify({ targetPlayerId: tP.id }));
							this.logger.log(`Bot socket: JW - Target set and emitted based on chat: <span class="math-inline">\{tP\.username\} \(</span>{tP.id}).`);

							// Gửi tin nhắn xác nhận vào chat sói
							const messageToSend = `Ok tag ${tP.gridIdx + 1}`;
							this.state.CUSTOM_GAME_SOCKET.emit("game:chat-werewolves:msg", JSON.stringify({ msg: messageToSend }));
							this.uiManager.addChatMessage(`💬 Sói con (Bot): Đã gửi "${messageToSend}" vào chat sói.`, false, 'color: #7B68EE;');
						}
                    }
                }
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-werewolves-vote-set', (_data) => {
                this.logger.log('Bot socket: Caught game-werewolves-vote-set event (New Logic).', _data);
                const d = JSON.parse(_data);
                this.logger.log('Bot WW Vote Set Event:', d);
                const cRD = this.state.getRoleById(this.state.CURRENT_GAME.role?.id || this.state.CURRENT_GAME.role);

                if (d.playerId === this.state.PLAYER.id) {
                    this.logger.log('Bot socket: WW Vote Set event is from self, skipping.');
                    return;
                }

                if (!this.state.CURRENT_GAME.juniorWerewolfTarget && cRD && cRD.id === 'junior-werewolf') {
                    this.logger.log('Bot socket: JW - Processing werewolf vote for target detection.');
                    const tP = this.state.CURRENT_GAME.players.find(v => v.id === d.targetPlayerId);
					if (tP && !this.state.CURRENT_GAME.deads.includes(tP.id)) {
						this.state.CURRENT_GAME.juniorWerewolfTarget = tP.id;
						this.uiManager.addChatMessage(`🐾 Mục tiêu Sói con (từ vote sói): ${tP.gridIdx + 1}. ${tP.username}`);
						this.state.CUSTOM_GAME_SOCKET.emit('game-junior-werewolf-selected-player', JSON.stringify({ targetPlayerId: d.targetPlayerId }));
						this.logger.log(`Bot socket: JW - Target set and emitted based on WW vote: <span class="math-inline">\{tP\.username\} \(</span>{tP.id}).`);

						// Gửi tin nhắn xác nhận vào chat sói
						const messageToSend = `Ok tag ${tP.gridIdx + 1}`;
						this.state.CUSTOM_GAME_SOCKET.emit("game:chat-werewolves:msg", JSON.stringify({ msg: messageToSend }));
						this.uiManager.addChatMessage(`💬 Sói con (Bot): Đã gửi "${messageToSend}" vào chat sói.`, false, 'color: #7B68EE;');
					}
                }

                const voterRoleInfo = this.state.CURRENT_GAME.werewolves.find(w => w.id === d.playerId);
                if (cRD && cRD.id !== 'junior-werewolf' && voterRoleInfo && voterRoleInfo.role === 'junior-werewolf') {
                    this.logger.log('Bot socket: Normal WW - Following Junior Werewolf vote.');
                    const tP = this.state.CURRENT_GAME.players.find(v => v.id === d.targetPlayerId);
                    if (tP && !this.state.CURRENT_GAME.deads.includes(tP.id)) {
                        if (this.state.CURRENT_GAME.targetWerewolfVote !== d.targetPlayerId) {
                            setTimeout(() => {
                                this.uiManager.addChatMessage(`👉 WW Vote (theo Sói trẻ): ${tP.gridIdx + 1}. ${tP.username}`);
                                this.state.CURRENT_GAME.targetWerewolfVote = d.targetPlayerId;
                                this.state.CUSTOM_GAME_SOCKET.emit('game-werewolves-vote-set', JSON.stringify({ targetPlayerId: d.targetPlayerId }));
                                this.logger.log(`Bot socket: Normal WW - Emitted vote for ${tP.username} (${tP.id}) following JW.`);
                            }, 1000 + Math.random() * 500);
                        }
                    }
                }
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-day-voting-started', () => {
                this.logger.log('Bot socket: Caught game-day-voting-started event. Calling handleDayVote.');
                this.uiManager.addChatMessage('☀️ Bắt đầu vote ngày (Bot).');
                this.gameLogic.handleDayVote();
            });

            this.state.CUSTOM_GAME_SOCKET.on('game:chat-public:msg', (_data) => {
                this.logger.log('Bot socket: Caught game:chat-public:msg event.', _data);
                const d = JSON.parse(_data);
                this.logger.log('Bot CHAT MSG:', d);
                this.state.CURRENT_GAME.chatMessages.push({ chat: "public", senderPlayerId: d.authorId, text: d.msg, timestamp: new Date().getTime() });
                if (this.state.CURRENT_GAME.chatMessages.length > MAX_CHAT_MESSAGES) {
                    this.state.CURRENT_GAME.chatMessages.shift();
                }
                this.gameLogic.handlePublicChatVote(JSON.stringify(d));
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-day-vote-set', (_data) => {
                this.logger.log('Bot socket: Caught game-day-vote-set event.', _data);
                this.logger.log('Bot Day Vote Set Event:', JSON.parse(_data));
                this.gameLogic.handleDayKillSkills(_data);
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-reconnect-set-players', (_data) => {
                this.logger.log('Bot socket: Caught game-reconnect-set-players event.', _data);
                const d = JSON.parse(_data);
                this.state.CURRENT_GAME.deads = [];
                Object.values(d).forEach(p => {
                    if (!p.isAlive) this.state.CURRENT_GAME.deads.push(p.id);
                    if (this.state.PLAYER && p.id === this.state.PLAYER.id) {
                        this.state.PLAYER.isAlive = p.isAlive;
                        this.logger.log(`Bot socket: Player isAlive updated from reconnect-set-players: ${this.state.PLAYER.isAlive}`);
                    }
                });
                this.state.CURRENT_GAME.players = Object.values(d);
                this.logger.log('Bot: Reconnected, players and deads updated.', { playersCount: this.state.CURRENT_GAME.players.length, deadsCount: this.state.CURRENT_GAME.deads.length });
            });

            this.state.CUSTOM_GAME_SOCKET.on('game-over-awards-available', async (_data) => {
                this.logger.log('Bot socket: Caught game-over-awards-available event.', _data);
                const d = JSON.parse(_data);
                this.uiManager.addChatMessage(`🎉 Game Over (Bot). XP: ${d.playerAward.awardedTotalXp}`, true, 'color:#f1c40f;');
				if (parsedData.playerAward.canClaimDoubleXp) {
					if (this.state.CUSTOM_GAME_SOCKET && !this.state.CUSTOM_GAME_SOCKET.disconnected) {
						this.state.CUSTOM_GAME_SOCKET.emit('game-over-double-xp');
						this.uiManager.addChatMessage('Claimed double xp via Bot!', true, 'color:rgb(17,255,0);');
						this.logger.log('Bot socket: Emitted game-over-double-xp.');
					} else {
						this.logger.log('MainSocket: Bot socket chưa kết nối, không thể emit double xp.');
					}
				}
                try {
                    await this.apiHandler.fetchPlayerData();
                    this.logger.log('Bot socket DEBUG: fetchPlayerData completed after game over. Updated PLAYER object:', this.state.PLAYER);
                } catch (err) {
                    console.error(`[${SCRIPT_NAME}] SocketHandler: Error fetching player data after game over from bot socket:`, err);
                    this.uiManager.addChatMessage('Error updating player XP data after game over (Bot).', true, 'color: #e74c3c;');
                }

                setTimeout(() => {
                    if (this.state.CUSTOM_GAME_SOCKET) {
                        this.logger.log('Bot socket: Disconnecting custom socket after game over.');
                        this.state.CUSTOM_GAME_SOCKET.disconnect();
                    }
                }, 1000);
            });

            this.state.CUSTOM_GAME_SOCKET.onAny((...args) => {
                if (this.state.SETTINGS.debugMode) {
                    const eN = args[0];
                    if (!['player-moved', 'player-stats-updated', 'game-time-sync', 'ping', 'pong'].includes(eN)) {
                        this.logger.log('[BotSocket Unhandled MSG]', args);
                    }
                }
            });
            this.logger.log('SocketHandler: Custom game socket connection logic complete.');
        }
    }

    class MainController {
        constructor() {
            console.log(`[${SCRIPT_NAME}] MainController: Initializing application components...`);
            this.stateManager = new StateManager();
            this.logger = new Logger(this.stateManager);
            this.gameLogic = new GameLogic(this.stateManager, this.logger);
            this.uiManager = new UiManager(this.stateManager, this.logger, null);
            this.socketHandler = new SocketHandler(this.stateManager, this.logger, this.uiManager, this.gameLogic, null);
            this.apiHandler = new ApiHandler(this.stateManager, this.logger, this.uiManager, this.socketHandler);

            this.uiManager.apiHandler = this.apiHandler;
            this.socketHandler.apiHandler = this.apiHandler;
            this.gameLogic.setDependencies(this.uiManager, this.socketHandler);
            this.logger.log('MainController: All components initialized and dependencies set.');
        }

        async init() {
            this.logger.log(`MainController: Starting initialization process (async).`);
            await this.stateManager.init();

            $(document).ready(async () => {
                this.logger.log(`🚀 ${SCRIPT_NAME} v${SCRIPT_VERSION} starting (DOM ready)...`);
                this.apiHandler.getAuthTokensFromLocalStorage();
                await this.uiManager.init();
                this.uiManager.addChatMessage(`${SCRIPT_NAME} v${SCRIPT_VERSION} đã tải!`, true, 'color: #6cb6ff;');
                this.logger.log('MainController: DOM ready tasks completed.');

                if (this.stateManager.SETTINGS.autoFetchPlayerData && this.stateManager.AUTHTOKENS.idToken) {
                    this.logger.log('MainController: Auto-fetching player data due to settings and existing ID token.');
                    this.apiHandler.fetchPlayerData();
                } else {
                    this.logger.log('MainController: Auto-fetch player data skipped (setting disabled or ID token missing).');
                }
            });
            this.socketHandler.mainSocketInterceptor();
            this.apiHandler.interceptCloudflareJWT();
            this.logger.log('MainController: Initialization process complete. Waiting for DOM ready and game events.');
        }
    }

    console.log(`[${SCRIPT_NAME}] Initializing MainController...`);
    const mainController = new MainController();
    mainController.init().catch(err => {
        console.error(`[${SCRIPT_NAME}] Critical error in main function:`, err);
        if (mainController.uiManager) {
            mainController.uiManager.addChatMessage(`Critical error: ${err.message}. Check console.`, true, 'color: #e74c3c;');
        } else {
            console.error(`[${SCRIPT_NAME}] UiManager not initialized. Cannot display critical error in UI.`);
        }
    });
    console.log(`[${SCRIPT_NAME}] MainController initialization triggered.`);

})();