// =============================================================
// 1. PRIPOJENIE NA SUPABASE
// =============================================================
const SUPABASE_URL = "https://uisokzgwgmtezxgrpdtc.supabase.co"
const SUPABASE_KEY = "sb_publishable_ZhVISeAmC1eQkikZGW3YtA_fPjyFnQF"

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)

// =============================================================
// 2. STAV APLIKÁCIE
// =============================================================
let players = []
let rounds = []
let pendingPlayers = []

let loggedPlayer = null
let isAdmin = false
let adminPinSession = null
let openedPlayers = {}
let openedRounds = {}
let isLoading = false

let selectedSummaryRoundId = null
let activeChartType = null
let positionChartInstance = null
let pointsChartInstance = null

let serverTimeOffsetMs = 0
let countdownIntervalId = null
const countdownRefreshKeys = new Set()

// Prednastavené tímy pre výber pri pridávaní zápasu.
const TEAMS = [
    "Slovan Bratislava",
    "Podbrezová",
    "Žilina",
    "Trnava",
    "Ružomberok",
    "Dunajská Streda",
    "Skalica",
    "FC Košice",
    "Komárno",
    "Trenčín",
    "Michalovce",
    "B. Bystrica"
]

// =============================================================
// 3. POMOCNÉ FUNKCIE
// =============================================================
const rpc = async (functionName, parameters = {}) => {
    const { data, error } = await supabaseClient.rpc(functionName, parameters)

    if (error) throw error

    return data
}


const chooseMatchName = () => {
    return new Promise(resolve => {
        const overlay = document.createElement("div")
        overlay.className = "team-picker-overlay"

        const modal = document.createElement("div")
        modal.className = "team-picker-modal"
        modal.setAttribute("role", "dialog")
        modal.setAttribute("aria-modal", "true")
        modal.setAttribute("aria-labelledby", "team-picker-title")

        const title = document.createElement("h3")
        title.id = "team-picker-title"
        title.textContent = "Vyber tímy"

        const homeLabel = document.createElement("label")
        homeLabel.textContent = "Domáci tím"

        const homeSelect = document.createElement("select")
        homeSelect.innerHTML = '<option value="">-- vyber domáci tím --</option>'

        const awayLabel = document.createElement("label")
        awayLabel.textContent = "Hosťujúci tím"

        const awaySelect = document.createElement("select")
        awaySelect.innerHTML = '<option value="">-- vyber hosťujúci tím --</option>'

        TEAMS.forEach(team => {
            const homeOption = document.createElement("option")
            homeOption.value = team
            homeOption.textContent = team
            homeSelect.appendChild(homeOption)

            const awayOption = document.createElement("option")
            awayOption.value = team
            awayOption.textContent = team
            awaySelect.appendChild(awayOption)
        })

        const errorText = document.createElement("p")
        errorText.className = "team-picker-error"
        errorText.setAttribute("aria-live", "polite")

        const actions = document.createElement("div")
        actions.className = "team-picker-actions"

        const cancelButton = document.createElement("button")
        cancelButton.type = "button"
        cancelButton.textContent = "Zrušiť"

        const addButton = document.createElement("button")
        addButton.type = "button"
        addButton.textContent = "Pridať zápas"

        const close = value => {
            document.removeEventListener("keydown", handleEscape)
            overlay.remove()
            resolve(value)
        }

        const handleEscape = event => {
            if (event.key === "Escape") close(null)
        }

        cancelButton.addEventListener("click", () => close(null))

        addButton.addEventListener("click", () => {
            const homeTeam = homeSelect.value
            const awayTeam = awaySelect.value

            if (!homeTeam || !awayTeam) {
                errorText.textContent = "Vyber domáci aj hosťujúci tím."
                return
            }

            if (homeTeam === awayTeam) {
                errorText.textContent = "Domáci a hosťujúci tím nemôžu byť rovnaké."
                return
            }

            close(`${homeTeam} : ${awayTeam}`)
        })

        overlay.addEventListener("click", event => {
            if (event.target === overlay) close(null)
        })

        document.addEventListener("keydown", handleEscape)

        homeLabel.appendChild(homeSelect)
        awayLabel.appendChild(awaySelect)
        actions.append(cancelButton, addButton)
        modal.append(title, homeLabel, awayLabel, errorText, actions)
        overlay.appendChild(modal)
        document.body.appendChild(overlay)

        homeSelect.focus()
    })
}

const rerenderRoundsPreservingPosition = () => {
    const windowScrollY = window.scrollY
    const horizontalScroll = {}

    document
        .querySelectorAll(".round-card[data-round-id] .table-scroll")
        .forEach(scrollContainer => {
            const roundCard = scrollContainer.closest(".round-card")
            if (!roundCard) return

            horizontalScroll[roundCard.dataset.roundId] =
                scrollContainer.scrollLeft
        })

    renderRoundsTable()

    requestAnimationFrame(() => {
        Object.entries(horizontalScroll).forEach(([roundId, scrollLeft]) => {
            const scrollContainer = document.querySelector(
                `.round-card[data-round-id="${roundId}"] .table-scroll`
            )

            if (scrollContainer) {
                scrollContainer.scrollLeft = scrollLeft
            }
        })

        window.scrollTo({
            top: windowScrollY,
            left: 0,
            behavior: "auto"
        })
    })
}

const getErrorMessage = (error, fallback) => {
    if (!error) return fallback

    return error.message || error.details || fallback
}

const setLoading = (loading) => {
    isLoading = loading

    document.querySelectorAll("button").forEach(button => {
        button.disabled = loading
    })
}

const hasDeadlinePassed = (round) => {
    if (typeof round.deadline_passed === "boolean") {
        return round.deadline_passed
    }

    if (!round.deadline) return false
    return new Date(round.deadline) <= new Date()
}

const isRoundClosed = (round) => {
    if (typeof round.effective_closed === "boolean") {
        return round.effective_closed
    }

    return Boolean(round.is_closed) || hasDeadlinePassed(round)
}

const getCurrentServerTimeMs = () => {
    return Date.now() + serverTimeOffsetMs
}

const formatRemainingTime = milliseconds => {
    const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))

    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    const parts = []

    if (days > 0) parts.push(`${days} d`)
    parts.push(`${String(hours).padStart(2, "0")} h`)
    parts.push(`${String(minutes).padStart(2, "0")} min`)
    parts.push(`${String(seconds).padStart(2, "0")} s`)

    return parts.join(" ")
}

const updateRoundCountdowns = () => {
    document
        .querySelectorAll(".round-countdown[data-deadline]")
        .forEach(element => {
            const deadline = element.dataset.deadline
            const roundId = element.dataset.roundId
            if (!deadline || !roundId) return

            const remaining =
                new Date(deadline).getTime() - getCurrentServerTimeMs()

            if (remaining > 0) {
                element.textContent =
                    `⏳ Do uzávierky zostáva: ${formatRemainingTime(remaining)}`
                return
            }

            element.textContent =
                "⏳ Čas na tipovanie práve vypršal. Obnovujem kolo…"

            const refreshKey = `${roundId}:${deadline}`

            if (!countdownRefreshKeys.has(refreshKey)) {
                countdownRefreshKeys.add(refreshKey)

                window.setTimeout(() => {
                    if (!isLoading) refreshAllData()
                }, 250)
            }
        })
}

const startCountdownTimer = () => {
    if (countdownIntervalId) {
        clearInterval(countdownIntervalId)
    }

    updateRoundCountdowns()
    countdownIntervalId = window.setInterval(updateRoundCountdowns, 1000)
}

const getRoundDisplayPlayers = () => {
    if (!loggedPlayer) return [...players]

    const myId = Number(loggedPlayer.id)
    const me = players.find(player => Number(player.id) === myId)
    const others = players.filter(player => Number(player.id) !== myId)

    return me ? [me, ...others] : [...players]
}

const toLocalDateTimeInputValue = isoValue => {
    if (!isoValue) return ""

    const date = new Date(isoValue)
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)

    return local.toISOString().slice(0, 16)
}

const chooseDeadline = currentDeadline => {
    return new Promise(resolve => {
        const overlay = document.createElement("div")
        overlay.className = "team-picker-overlay"

        const modal = document.createElement("div")
        modal.className = "team-picker-modal deadline-picker-modal"
        modal.setAttribute("role", "dialog")
        modal.setAttribute("aria-modal", "true")

        const title = document.createElement("h3")
        title.textContent = "Zmeniť uzávierku"

        const label = document.createElement("label")
        label.textContent = "Nový dátum a čas uzávierky"

        const input = document.createElement("input")
        input.type = "datetime-local"
        input.value = toLocalDateTimeInputValue(currentDeadline)

        const info = document.createElement("p")
        info.className = "deadline-picker-info"
        info.textContent =
            "Po dosiahnutí tohto času sa tipovanie automaticky uzavrie."

        const errorText = document.createElement("p")
        errorText.className = "team-picker-error"

        const actions = document.createElement("div")
        actions.className = "team-picker-actions"

        const cancelButton = document.createElement("button")
        cancelButton.type = "button"
        cancelButton.textContent = "Zrušiť"

        const saveButton = document.createElement("button")
        saveButton.type = "button"
        saveButton.textContent = "Uložiť uzávierku"

        const close = value => {
            document.removeEventListener("keydown", handleEscape)
            overlay.remove()
            resolve(value)
        }

        const handleEscape = event => {
            if (event.key === "Escape") close(null)
        }

        cancelButton.addEventListener("click", () => close(null))

        saveButton.addEventListener("click", () => {
            if (!input.value) {
                errorText.textContent = "Vyber dátum a čas."
                return
            }

            close(new Date(input.value).toISOString())
        })

        overlay.addEventListener("click", event => {
            if (event.target === overlay) close(null)
        })

        document.addEventListener("keydown", handleEscape)

        label.appendChild(input)
        actions.append(cancelButton, saveButton)
        modal.append(title, label, info, errorText, actions)
        overlay.appendChild(modal)
        document.body.appendChild(overlay)

        input.focus()
    })
}

const getTip = (match, playerId) => {
    return (match.tips || []).find(tip => {
        return Number(tip.player_id) === Number(playerId)
    }) || null
}

const get1X2 = ({ home, away }) => {
    if (home > away) return 1
    if (home === away) return "X"
    return 2
}

const calculateMatchPoints = (result, tip) => {
    if (!result || !tip) return 0

    const resultDiff = result.home - result.away
    const tipDiff = tip.home - tip.away
    const resultSum = result.home + result.away
    const tipSum = tip.home + tip.away

    if (result.home === tip.home && result.away === tip.away) {
        return 10
    }

    if (get1X2(result) === get1X2(tip) && resultDiff === tipDiff) {
        return 6
    }

    if (get1X2(result) === get1X2(tip) && resultSum === tipSum) {
        return 6
    }

    if (get1X2(result) === get1X2(tip)) {
        return 4
    }

    if (resultSum === tipSum) {
        return 2
    }

    return 0
}

const countPlayerPoints = (playerId) => {
    let total = 0

    rounds.forEach(round => {
        if (!isRoundClosed(round)) return

        ;(round.matches || []).forEach(match => {
            if (match.result_home === null || match.result_away === null) return

            const tip = getTip(match, playerId)
            if (!tip) return

            total += calculateMatchPoints(
                {
                    home: Number(match.result_home),
                    away: Number(match.result_away)
                },
                {
                    home: Number(tip.home),
                    away: Number(tip.away)
                }
            )
        })
    })

    return total
}

const getRoundPoints = (round, playerId) => {
    if (!isRoundClosed(round)) return 0

    let total = 0

    ;(round.matches || []).forEach(match => {
        if (match.result_home === null || match.result_away === null) return

        const tip = getTip(match, playerId)
        if (!tip) return

        total += calculateMatchPoints(
            {
                home: Number(match.result_home),
                away: Number(match.result_away)
            },
            {
                home: Number(tip.home),
                away: Number(tip.away)
            }
        )
    })

    return total
}

// T-B1: body získané v zápasoch, ktorých názov obsahuje „Trnava“.
const countTrnavaPoints = (playerId) => {
    let total = 0

    rounds.forEach(round => {
        if (!isRoundClosed(round)) return

        ;(round.matches || []).forEach(match => {
            const matchName = String(match.name || "").toLocaleLowerCase("sk")
            if (!matchName.includes("trnava")) return
            if (match.result_home === null || match.result_away === null) return

            const tip = getTip(match, playerId)
            if (!tip) return

            total += calculateMatchPoints(
                {
                    home: Number(match.result_home),
                    away: Number(match.result_away)
                },
                {
                    home: Number(tip.home),
                    away: Number(tip.away)
                }
            )
        })
    })

    return total
}

// T-B2: počet presných tipov, za ktoré hráč získal 10 bodov.
const countExactTenPointTips = (playerId) => {
    let exactTips = 0

    rounds.forEach(round => {
        if (!isRoundClosed(round)) return

        ;(round.matches || []).forEach(match => {
            if (match.result_home === null || match.result_away === null) return

            const tip = getTip(match, playerId)
            if (!tip) return

            const points = calculateMatchPoints(
                {
                    home: Number(match.result_home),
                    away: Number(match.result_away)
                },
                {
                    home: Number(tip.home),
                    away: Number(tip.away)
                }
            )

            if (points === 10) exactTips += 1
        })
    })

    return exactTips
}


const getClosedRoundEntries = () => {
    return rounds
        .map((round, index) => ({ round, index }))
        .filter(item => isRoundClosed(item.round))
}

const countPlayerPointsThroughRound = (playerId, targetRoundIndex) => {
    let total = 0

    rounds.forEach((round, roundIndex) => {
        if (roundIndex > targetRoundIndex) return
        if (!isRoundClosed(round)) return

        ;(round.matches || []).forEach(match => {
            if (match.result_home === null || match.result_away === null) return

            const tip = getTip(match, playerId)
            if (!tip) return

            total += calculateMatchPoints(
                {
                    home: Number(match.result_home),
                    away: Number(match.result_away)
                },
                {
                    home: Number(tip.home),
                    away: Number(tip.away)
                }
            )
        })
    })

    return total
}

const countTrnavaPointsThroughRound = (playerId, targetRoundIndex) => {
    let total = 0

    rounds.forEach((round, roundIndex) => {
        if (roundIndex > targetRoundIndex) return
        if (!isRoundClosed(round)) return

        ;(round.matches || []).forEach(match => {
            const matchName = String(match.name || "").toLocaleLowerCase("sk")
            if (!matchName.includes("trnava")) return
            if (match.result_home === null || match.result_away === null) return

            const tip = getTip(match, playerId)
            if (!tip) return

            total += calculateMatchPoints(
                {
                    home: Number(match.result_home),
                    away: Number(match.result_away)
                },
                {
                    home: Number(tip.home),
                    away: Number(tip.away)
                }
            )
        })
    })

    return total
}

const countExactTenPointTipsThroughRound = (playerId, targetRoundIndex) => {
    let exactTips = 0

    rounds.forEach((round, roundIndex) => {
        if (roundIndex > targetRoundIndex) return
        if (!isRoundClosed(round)) return

        ;(round.matches || []).forEach(match => {
            if (match.result_home === null || match.result_away === null) return

            const tip = getTip(match, playerId)
            if (!tip) return

            const points = calculateMatchPoints(
                {
                    home: Number(match.result_home),
                    away: Number(match.result_away)
                },
                {
                    home: Number(tip.home),
                    away: Number(tip.away)
                }
            )

            if (points === 10) exactTips += 1
        })
    })

    return exactTips
}

const getStandingsAfterRound = roundIndex => {
    return players
        .map(player => ({
            ...player,
            roundPoints: getRoundPoints(rounds[roundIndex], player.id),
            cumulativePoints: countPlayerPointsThroughRound(player.id, roundIndex),
            trnavaPoints: countTrnavaPointsThroughRound(player.id, roundIndex),
            exactTenPointTips: countExactTenPointTipsThroughRound(player.id, roundIndex)
        }))
        .sort((a, b) => {
            if (b.cumulativePoints !== a.cumulativePoints) {
                return b.cumulativePoints - a.cumulativePoints
            }

            if (b.trnavaPoints !== a.trnavaPoints) {
                return b.trnavaPoints - a.trnavaPoints
            }

            if (b.exactTenPointTips !== a.exactTenPointTips) {
                return b.exactTenPointTips - a.exactTenPointTips
            }

            return a.name.localeCompare(b.name, "sk")
        })
}

const getPlayerChartColor = (index, totalPlayers) => {
    const hue = Math.round((index * 360) / Math.max(totalPlayers, 1))
    return `hsl(${hue} 72% 58%)`
}

const updateControlsVisibility = () => {
    const adminControls = document.querySelector("#admin-game-controls")
    const logoutButton = document.querySelector("#btn-logout")
    const adminLoginButton = document.querySelector("#btn-admin-login")
    const registerButton = document.querySelector("#btn-register")
    const loginButton = document.querySelector("#btn-login")
    const loginInfo = document.querySelector("#login-info")
    const resetButton = document.querySelector("#btn-reset")
    const backupButton = document.querySelector("#btn-backup")
    const restoreButton = document.querySelector("#btn-restore")

    // Kolo, zápas a výsledok môže pridávať admin aj každý
    // schválený prihlásený hráč. Mazanie a zálohy ostávajú adminovi.
    const canManageGame = Boolean(isAdmin || loggedPlayer)

    adminControls.hidden = !canManageGame
    resetButton.hidden = !isAdmin
    backupButton.hidden = !isAdmin
    restoreButton.hidden = !isAdmin

    logoutButton.hidden = !loggedPlayer && !isAdmin
    adminLoginButton.hidden = isAdmin || Boolean(loggedPlayer)
    registerButton.hidden = isAdmin || Boolean(loggedPlayer)
    loginButton.hidden = isAdmin || Boolean(loggedPlayer)

    if (isAdmin) {
        loginInfo.textContent = "Prihlásený: ADMIN"
    } else if (loggedPlayer) {
        loginInfo.textContent = `Prihlásený: ${loggedPlayer.name}`
    } else {
        loginInfo.textContent = "Nikto nie je prihlásený"
    }
}

// =============================================================
// 4. NAČÍTANIE DÁT
// =============================================================
const loadGameData = async () => {
    const data = await rpc("get_game_data", {
        p_player_id: loggedPlayer?.id ?? null,
        p_pin: loggedPlayer?.pin ?? null
    })

    if (data?.server_now) {
        serverTimeOffsetMs =
            new Date(data.server_now).getTime() - Date.now()
    }

    players = Array.isArray(data?.players) ? data.players : []
    rounds = Array.isArray(data?.rounds) ? data.rounds : []

    if (
        loggedPlayer
        && !Object.prototype.hasOwnProperty.call(
            openedPlayers,
            loggedPlayer.id
        )
    ) {
        openedPlayers[loggedPlayer.id] = true
    }
}

const loadPendingPlayers = async () => {
    if (!isAdmin || !adminPinSession) {
        pendingPlayers = []
        return
    }

    const data = await rpc("get_pending_players", {
        p_admin_pin: adminPinSession
    })

    pendingPlayers = Array.isArray(data) ? data : []
}

const refreshAllData = async () => {
    if (isLoading) return

    setLoading(true)

    try {
        await loadGameData()
        await loadPendingPlayers()
        renderAll()
    } catch (error) {
        console.error("Načítanie zlyhalo:", error)
        alert(getErrorMessage(error, "Údaje sa nepodarilo načítať."))
    } finally {
        setLoading(false)
        updateControlsVisibility()
        updateChartPanels()
    }
}

// =============================================================
// 5. VYKRESLENIE HLAVNEJ TABUĽKY
// =============================================================
const renderPlayersTable = () => {
    const tableBody = document.querySelector("#table-body")
    tableBody.innerHTML = ""

    const orderedPlayers = players
        .map(player => ({
            ...player,
            points: countPlayerPoints(player.id),
            trnavaPoints: countTrnavaPoints(player.id),
            exactTenPointTips: countExactTenPointTips(player.id)
        }))
        .sort((a, b) => {
            // Hlavné poradie: celkové body.
            if (b.points !== a.points) return b.points - a.points

            // T-B1: pri rovnosti bodov rozhodujú body zo zápasov Trnavy.
            if (b.trnavaPoints !== a.trnavaPoints) {
                return b.trnavaPoints - a.trnavaPoints
            }

            // T-B2: potom počet presných 10-bodových tipov.
            if (b.exactTenPointTips !== a.exactTenPointTips) {
                return b.exactTenPointTips - a.exactTenPointTips
            }

            return a.name.localeCompare(b.name, "sk")
        })

    orderedPlayers.forEach((player, index) => {
        const row = document.createElement("tr")

        const orderCell = document.createElement("td")
        orderCell.textContent = String(index + 1)

        const nameCell = document.createElement("td")
        nameCell.textContent = player.name

        const pointsCell = document.createElement("td")
        pointsCell.textContent = String(player.points)

        const trnavaPointsCell = document.createElement("td")
        trnavaPointsCell.textContent = String(player.trnavaPoints)
        trnavaPointsCell.title = "T-B1: body získané v zápasoch Trnavy"

        const exactTipsCell = document.createElement("td")
        exactTipsCell.textContent = String(player.exactTenPointTips)
        exactTipsCell.title = "T-B2: počet presných tipov za 10 bodov"

        row.append(
            orderCell,
            nameCell,
            pointsCell,
            trnavaPointsCell,
            exactTipsCell
        )
        tableBody.appendChild(row)
    })
}

// =============================================================
// 6. ULOŽENIE TIPU A VÝSLEDKU
// =============================================================
const saveTip = async (matchId, home, away) => {
    if (!loggedPlayer) {
        alert("Najprv sa musíš prihlásiť.")
        return
    }

    if (home === "" || away === "") return

    try {
        await rpc("save_tip", {
            p_player_id: loggedPlayer.id,
            p_pin: loggedPlayer.pin,
            p_match_id: matchId,
            p_home: Number(home),
            p_away: Number(away)
        })

        await refreshAllData()
    } catch (error) {
        console.error("Tip sa nepodarilo uložiť:", error)
        alert(getErrorMessage(error, "Tip sa nepodarilo uložiť."))
        await refreshAllData()
    }
}


const clearResult = async matchId => {
    if (!isAdmin || !adminPinSession) {
        alert("Výsledok môže vymazať iba admin.")
        return
    }

    const confirmed = confirm(
        "Naozaj chceš vymazať zadaný výsledok tohto zápasu?"
    )

    if (!confirmed) return

    try {
        await rpc("clear_result", {
            p_admin_pin: adminPinSession,
            p_match_id: matchId
        })

        await refreshAllData()
    } catch (error) {
        console.error("Výsledok sa nepodarilo vymazať:", error)
        alert(
            getErrorMessage(
                error,
                "Výsledok sa nepodarilo vymazať."
            )
        )
        await refreshAllData()
    }
}

const saveResult = async (matchId, home, away) => {
    if (!isAdmin && !loggedPlayer) {
        alert("Najprv sa musíš prihlásiť.")
        return
    }

    if (home === "" || away === "") return

    try {
        if (isAdmin) {
            await rpc("save_result", {
                p_admin_pin: adminPinSession,
                p_match_id: matchId,
                p_home: Number(home),
                p_away: Number(away)
            })
        } else {
            await rpc("player_save_result", {
                p_player_id: loggedPlayer.id,
                p_pin: loggedPlayer.pin,
                p_match_id: matchId,
                p_home: Number(home),
                p_away: Number(away)
            })
        }

        await refreshAllData()
    } catch (error) {
        console.error("Výsledok sa nepodarilo uložiť:", error)
        alert(getErrorMessage(error, "Výsledok sa nepodarilo uložiť."))
        await refreshAllData()
    }
}

// =============================================================
// 7. VYKRESLENIE KÔL A ZÁPASOV
// =============================================================
const renderRoundsTable = () => {
    const tableRound = document.querySelector("#table-round")
    tableRound.innerHTML = ""

    const roundPlayers = getRoundDisplayPlayers()

    rounds.forEach((round, roundIndex) => {
        const roundWrapper = document.createElement("section")
        roundWrapper.className = "round-card"
        roundWrapper.dataset.roundId = String(round.id)

        const title = document.createElement("h2")
        title.textContent = round.name

        const deadlinePassed = hasDeadlinePassed(round)
        const manuallyClosed = Boolean(round.is_closed)
        const roundClosed = isRoundClosed(round)

        const deadlineText = document.createElement("p")
        deadlineText.className = roundClosed
            ? "round-status round-status-closed"
            : "round-status round-status-open"

        const plannedTime = round.deadline
            ? new Date(round.deadline).toLocaleString("sk-SK")
            : "nezadaná"

        if (manuallyClosed) {
            deadlineText.textContent =
                `Tipovanie: UZAVRETÉ ADMINOM | Uzávierka: ${plannedTime}`
        } else if (deadlinePassed) {
            deadlineText.textContent =
                `Tipovanie: UZAVRETÉ ČASOM | Uzávierka: ${plannedTime}`
        } else {
            deadlineText.textContent =
                `Tipovanie: OTVORENÉ | Uzávierka: ${plannedTime}`
        }

        const countdownText = document.createElement("p")
        countdownText.className = "round-countdown"

        if (manuallyClosed) {
            countdownText.textContent =
                "Tipovanie bolo uzavreté adminom."
        } else if (deadlinePassed) {
            countdownText.textContent =
                "Čas na tipovanie už vypršal."
        } else if (round.deadline) {
            countdownText.dataset.deadline = round.deadline
            countdownText.dataset.roundId = String(round.id)
        } else {
            countdownText.textContent =
                "Uzávierka zatiaľ nie je nastavená."
        }

        const toggleButton = document.createElement("button")
        toggleButton.textContent = "Skryť"

        const addMatchButton = document.createElement("button")
        addMatchButton.textContent = "Pridať zápas"
        addMatchButton.hidden = !isAdmin && !loggedPlayer

        addMatchButton.addEventListener("click", async () => {
            const matchName = await chooseMatchName()
            if (!matchName) return

            try {
                if (isAdmin) {
                    await rpc("add_match", {
                        p_admin_pin: adminPinSession,
                        p_round_id: round.id,
                        p_name: matchName
                    })
                } else {
                    await rpc("player_add_match", {
                        p_player_id: loggedPlayer.id,
                        p_pin: loggedPlayer.pin,
                        p_round_id: round.id,
                        p_name: matchName
                    })
                }

                await refreshAllData()
            } catch (error) {
                console.error("Pridanie zápasu zlyhalo:", error)
                alert(getErrorMessage(error, "Zápas sa nepodarilo pridať."))
            }
        })

        const changeDeadlineButton = document.createElement("button")
        changeDeadlineButton.textContent = "Zmeniť uzávierku"
        changeDeadlineButton.hidden = !isAdmin

        changeDeadlineButton.addEventListener("click", async () => {
            const newDeadline = await chooseDeadline(round.deadline)
            if (!newDeadline) return

            try {
                await rpc("update_round_deadline", {
                    p_admin_pin: adminPinSession,
                    p_round_id: round.id,
                    p_deadline: newDeadline
                })

                await refreshAllData()
            } catch (error) {
                console.error("Zmena uzávierky zlyhala:", error)
                alert(
                    getErrorMessage(
                        error,
                        "Uzávierku sa nepodarilo zmeniť."
                    )
                )
            }
        })

        const closeRoundButton = document.createElement("button")
        closeRoundButton.hidden = !isAdmin || (deadlinePassed && !manuallyClosed)
        closeRoundButton.textContent = manuallyClosed
            ? "Znovu otvoriť tipovanie"
            : "Uzavrieť tipovanie"
        closeRoundButton.className = manuallyClosed
            ? "btn-reopen-round"
            : "btn-close-round"

        closeRoundButton.addEventListener("click", async () => {
            const newClosedState = !manuallyClosed

            if (!newClosedState && hasDeadlinePassed(round)) {
                alert(
                    "Uzávierka už časovo uplynula. Najprv nastav nový budúci čas uzávierky."
                )
                return
            }

            const confirmed = confirm(
                newClosedState
                    ? `Naozaj chceš uzavrieť tipovanie pre ${round.name} skôr? Hráči už nebudú môcť meniť tipy.`
                    : `Naozaj chceš znovu otvoriť tipovanie pre ${round.name}? Hráči budú môcť tipy opäť meniť až do nastavenej uzávierky.`
            )

            if (!confirmed) return

            try {
                await rpc("set_round_closed", {
                    p_admin_pin: adminPinSession,
                    p_round_id: round.id,
                    p_closed: newClosedState
                })

                await refreshAllData()
            } catch (error) {
                console.error("Zmena uzávierky zlyhala:", error)
                alert(
                    getErrorMessage(
                        error,
                        "Stav tipovania sa nepodarilo zmeniť."
                    )
                )
            }
        })

        const deleteRoundButton = document.createElement("button")
        deleteRoundButton.textContent = "Odstrániť kolo"
        deleteRoundButton.hidden = !isAdmin

        deleteRoundButton.addEventListener("click", async () => {
            const confirmed = confirm(`Naozaj chceš odstrániť ${round.name}?`)
            if (!confirmed) return

            try {
                await rpc("delete_round", {
                    p_admin_pin: adminPinSession,
                    p_round_id: round.id
                })

                await refreshAllData()
            } catch (error) {
                console.error("Odstránenie kola zlyhalo:", error)
                alert(getErrorMessage(error, "Kolo sa nepodarilo odstrániť."))
            }
        })

        const tableScroll = document.createElement("div")
        tableScroll.className = "table-scroll"

        const table = document.createElement("table")

        const hasSavedRoundState = Object.prototype.hasOwnProperty.call(
            openedRounds,
            round.id
        )

        const isRoundOpen = hasSavedRoundState
            ? openedRounds[round.id]
            : roundIndex === rounds.length - 1

        tableScroll.hidden = !isRoundOpen
        toggleButton.textContent = isRoundOpen ? "Skryť" : "Zobraziť"

        toggleButton.addEventListener("click", () => {
            const willOpen = tableScroll.hidden

            tableScroll.hidden = !willOpen
            openedRounds[round.id] = willOpen
            toggleButton.textContent = willOpen ? "Skryť" : "Zobraziť"
        })

        const tableHead = document.createElement("thead")
        const firstHeaderRow = document.createElement("tr")
        const secondHeaderRow = document.createElement("tr")

        const matchHeader = document.createElement("th")
        matchHeader.textContent = "Zápas"
        matchHeader.rowSpan = 2
        matchHeader.classList.add("sticky-match-column")

        const resultHeader = document.createElement("th")
        resultHeader.rowSpan = 2
        resultHeader.classList.add("sticky-result-column")

        const resultHeaderTitle = document.createElement("span")
        resultHeaderTitle.className = "result-header-title"
        resultHeaderTitle.textContent = "Výsledok"

        const resultWarning = document.createElement("small")
        resultWarning.className = "result-warning"
        resultWarning.textContent =
            "(reálny výsledok – ❗ NIE VÁŠ TIP ❗)"

        resultHeader.append(resultHeaderTitle, resultWarning)

        firstHeaderRow.append(matchHeader, resultHeader)

        roundPlayers.forEach(player => {
            const playerHeader = document.createElement("th")
            const isOpened = Boolean(openedPlayers[player.id])

            playerHeader.textContent = isOpened
                ? `▼ ${player.name}`
                : `▶ ${player.name}`

            playerHeader.colSpan = isOpened ? 2 : 1
            playerHeader.style.cursor = "pointer"
            playerHeader.style.backgroundColor = player.color || "#e2e8f0"
            playerHeader.style.color = "#0f172a"

            playerHeader.addEventListener("click", event => {
                event.preventDefault()
                event.stopPropagation()

                openedPlayers[player.id] = !openedPlayers[player.id]
                rerenderRoundsPreservingPosition()
            })

            firstHeaderRow.appendChild(playerHeader)

            if (isOpened) {
                const tipHeader = document.createElement("th")
                tipHeader.textContent = "Tip"
                tipHeader.style.backgroundColor = player.color || "#e2e8f0"
                tipHeader.style.color = "#0f172a"

                const pointsHeader = document.createElement("th")
                pointsHeader.textContent = "Body"
                pointsHeader.style.backgroundColor = player.color || "#e2e8f0"
                pointsHeader.style.color = "#0f172a"

                secondHeaderRow.append(tipHeader, pointsHeader)
            } else {
                const emptyHeader = document.createElement("th")
                emptyHeader.style.backgroundColor = player.color || "#e2e8f0"
                secondHeaderRow.appendChild(emptyHeader)
            }
        })

        tableHead.append(firstHeaderRow, secondHeaderRow)

        const tableBody = document.createElement("tbody")

        ;(round.matches || []).forEach(match => {
            const row = document.createElement("tr")
            row.style.cursor = "pointer"

            row.addEventListener("click", () => {
                document.querySelectorAll(".active-match-row").forEach(activeRow => {
                    activeRow.classList.remove("active-match-row")
                })

                row.classList.add("active-match-row")
            })

            const matchCell = document.createElement("td")
            matchCell.classList.add("sticky-match-column")

            const matchName = document.createElement("span")
            matchName.textContent = match.name
            matchCell.appendChild(matchName)

            if (isAdmin) {
                const editButton = document.createElement("button")
                editButton.textContent = "Upraviť"

                editButton.addEventListener("click", async event => {
                    event.stopPropagation()

                    const newName = prompt("Zadaj nový názov", match.name)
                    if (!newName) return

                    try {
                        await rpc("update_match_name", {
                            p_admin_pin: adminPinSession,
                            p_match_id: match.id,
                            p_name: newName
                        })

                        await refreshAllData()
                    } catch (error) {
                        console.error("Úprava zápasu zlyhala:", error)
                        alert(getErrorMessage(error, "Zápas sa nepodarilo upraviť."))
                    }
                })

                const deleteButton = document.createElement("button")
                deleteButton.textContent = "Vymazať"

                deleteButton.addEventListener("click", async event => {
                    event.stopPropagation()

                    const confirmed = confirm(`Naozaj chceš vymazať zápas ${match.name}?`)
                    if (!confirmed) return

                    try {
                        await rpc("delete_match", {
                            p_admin_pin: adminPinSession,
                            p_match_id: match.id
                        })

                        await refreshAllData()
                    } catch (error) {
                        console.error("Odstránenie zápasu zlyhalo:", error)
                        alert(getErrorMessage(error, "Zápas sa nepodarilo odstrániť."))
                    }
                })

                matchCell.append(" ", editButton, " ", deleteButton)
            }

            const resultCell = document.createElement("td")
            resultCell.classList.add("sticky-result-column")

            const resultHome = document.createElement("input")
            const resultAway = document.createElement("input")

            resultHome.type = "number"
            resultAway.type = "number"
            resultHome.min = "0"
            resultAway.min = "0"
            resultHome.max = "99"
            resultAway.max = "99"
            resultHome.value = match.result_home ?? ""
            resultAway.value = match.result_away ?? ""
            const canEnterResult = Boolean(isAdmin || loggedPlayer)
            resultHome.disabled = !canEnterResult
            resultAway.disabled = !canEnterResult

            const saveCurrentResult = () => {
                saveResult(match.id, resultHome.value, resultAway.value)
            }

            resultHome.addEventListener("change", saveCurrentResult)
            resultAway.addEventListener("change", saveCurrentResult)

            resultCell.append(resultHome, " : ", resultAway)

            const hasSavedResult =
                match.result_home !== null
                && match.result_away !== null

            if (isAdmin && hasSavedResult) {
                const clearResultButton = document.createElement("button")
                clearResultButton.type = "button"
                clearResultButton.className = "btn-clear-result"
                clearResultButton.textContent = "Vymazať výsledok"
                clearResultButton.title = "Nastaví výsledok zápasu späť na prázdny"

                clearResultButton.addEventListener("click", event => {
                    event.preventDefault()
                    event.stopPropagation()
                    clearResult(match.id)
                })

                resultCell.appendChild(document.createElement("br"))
                resultCell.appendChild(clearResultButton)
            }

            row.append(matchCell, resultCell)

            roundPlayers.forEach(player => {
                const isOpened = Boolean(openedPlayers[player.id])
                const tip = getTip(match, player.id)
                const roundClosed = isRoundClosed(round)
                const isMyTip = Number(loggedPlayer?.id) === Number(player.id)

                if (!isOpened) {
                    const closedCell = document.createElement("td")
                    closedCell.textContent = "▶"
                    closedCell.style.backgroundColor = player.color || "#e2e8f0"
                    closedCell.style.color = "#0f172a"
                    row.appendChild(closedCell)
                    return
                }

                const tipCell = document.createElement("td")
                const pointsCell = document.createElement("td")
                tipCell.style.backgroundColor = player.color || "#e2e8f0"
                pointsCell.style.backgroundColor = player.color || "#e2e8f0"
                tipCell.style.color = "#0f172a"
                pointsCell.style.color = "#0f172a"

                const inputHome = document.createElement("input")
                const inputAway = document.createElement("input")

                inputHome.type = "number"
                inputAway.type = "number"
                inputHome.min = "0"
                inputAway.min = "0"
                inputHome.max = "99"
                inputAway.max = "99"

                inputHome.value = tip ? tip.home : ""
                inputAway.value = tip ? tip.away : ""

                const canEdit = isMyTip && !roundClosed
                inputHome.disabled = !canEdit
                inputAway.disabled = !canEdit

                const saveCurrentTip = () => {
                    saveTip(match.id, inputHome.value, inputAway.value)
                }

                inputHome.addEventListener("change", saveCurrentTip)
                inputAway.addEventListener("change", saveCurrentTip)

                tipCell.append(inputHome, " : ", inputAway)

                if (
                    roundClosed
                    && tip
                    && match.result_home !== null
                    && match.result_away !== null
                ) {
                    pointsCell.textContent = String(
                        calculateMatchPoints(
                            {
                                home: Number(match.result_home),
                                away: Number(match.result_away)
                            },
                            {
                                home: Number(tip.home),
                                away: Number(tip.away)
                            }
                        )
                    )
                } else {
                    pointsCell.textContent = "0"
                }

                row.append(tipCell, pointsCell)
            })

            tableBody.appendChild(row)
        })

        const totalRow = document.createElement("tr")
        totalRow.className = "round-total-row"

        const totalLabel = document.createElement("td")
        totalLabel.textContent = "Body v kole"
        totalLabel.colSpan = 2
        totalLabel.className = "round-total-label"
        totalRow.appendChild(totalLabel)

        roundPlayers.forEach(player => {
            const isOpened = Boolean(openedPlayers[player.id])
            const roundPoints = getRoundPoints(round, player.id)

            if (isOpened) {
                const emptyCell = document.createElement("td")
                emptyCell.textContent = "-"
                emptyCell.style.backgroundColor = player.color || "#e2e8f0"
                emptyCell.style.color = "#0f172a"

                const pointsCell = document.createElement("td")
                pointsCell.textContent = String(roundPoints)
                pointsCell.className = "round-total-points"
                pointsCell.style.backgroundColor = player.color || "#e2e8f0"
                pointsCell.style.color = "#0f172a"

                totalRow.append(emptyCell, pointsCell)
            } else {
                const pointsCell = document.createElement("td")
                pointsCell.textContent = String(roundPoints)
                pointsCell.className = "round-total-points"
                pointsCell.style.backgroundColor = player.color || "#e2e8f0"
                pointsCell.style.color = "#0f172a"
                totalRow.appendChild(pointsCell)
            }
        })

        tableBody.appendChild(totalRow)
        table.append(tableHead, tableBody)
        tableScroll.appendChild(table)

        const roundControls = document.createElement("div")
        roundControls.className = "round-controls"
        roundControls.append(
            toggleButton,
            addMatchButton,
            changeDeadlineButton,
            closeRoundButton,
            deleteRoundButton
        )

        roundWrapper.append(
            title,
            deadlineText,
            countdownText,
            roundControls,
            tableScroll
        )
        tableRound.appendChild(roundWrapper)
    })
}

// =============================================================
// 8. ADMIN PANEL
// =============================================================
const renderAdminPanel = () => {
    const adminPanel = document.querySelector("#admin-panel")
    adminPanel.innerHTML = ""
    adminPanel.hidden = !isAdmin

    if (!isAdmin) return

    const title = document.createElement("h2")
    title.textContent = "Čakajúce registrácie"
    adminPanel.appendChild(title)

    if (pendingPlayers.length === 0) {
        const emptyText = document.createElement("p")
        emptyText.textContent = "Žiadne čakajúce registrácie."
        adminPanel.appendChild(emptyText)
    }

    pendingPlayers.forEach(player => {
        const row = document.createElement("div")
        row.className = "pending-player"

        const name = document.createElement("strong")
        name.textContent = player.name

        const approveButton = document.createElement("button")
        approveButton.textContent = "Schváliť"

        approveButton.addEventListener("click", async () => {
            try {
                await rpc("approve_player", {
                    p_admin_pin: adminPinSession,
                    p_player_id: player.id
                })

                await refreshAllData()
            } catch (error) {
                console.error("Schválenie zlyhalo:", error)
                alert(getErrorMessage(error, "Hráča sa nepodarilo schváliť."))
            }
        })

        const deleteButton = document.createElement("button")
        deleteButton.textContent = "Zamietnuť"

        deleteButton.addEventListener("click", async () => {
            const confirmed = confirm(`Naozaj chceš zamietnuť hráča ${player.name}?`)
            if (!confirmed) return

            try {
                await rpc("delete_player", {
                    p_admin_pin: adminPinSession,
                    p_player_id: player.id
                })

                await refreshAllData()
            } catch (error) {
                console.error("Zamietnutie zlyhalo:", error)
                alert(getErrorMessage(error, "Registráciu sa nepodarilo zamietnuť."))
            }
        })

        row.append(name, approveButton, deleteButton)
        adminPanel.appendChild(row)
    })

    const playersTitle = document.createElement("h2")
    playersTitle.textContent = "Správa hráčov"
    adminPanel.appendChild(playersTitle)

    if (players.length === 0) {
        const noPlayers = document.createElement("p")
        noPlayers.textContent = "Žiadni schválení hráči."
        adminPanel.appendChild(noPlayers)
        return
    }

    players.forEach(player => {
        const row = document.createElement("div")
        row.className = "pending-player approved-player-row"

        const name = document.createElement("strong")
        name.textContent = player.name

        const deleteButton = document.createElement("button")
        deleteButton.textContent = "Odstrániť hráča"
        deleteButton.className = "btn-delete-player"

        deleteButton.addEventListener("click", async () => {
            const confirmed = confirm(
                `Naozaj chceš odstrániť hráča ${player.name}? Vymažú sa aj všetky jeho tipy. Túto operáciu nie je možné vrátiť späť.`
            )

            if (!confirmed) return

            try {
                await rpc("delete_approved_player", {
                    p_admin_pin: adminPinSession,
                    p_player_id: player.id
                })

                delete openedPlayers[player.id]
                await refreshAllData()
            } catch (error) {
                console.error("Odstránenie hráča zlyhalo:", error)
                alert(
                    getErrorMessage(
                        error,
                        "Hráča sa nepodarilo odstrániť."
                    )
                )
            }
        })

        row.append(name, deleteButton)
        adminPanel.appendChild(row)
    })
}


const renderRoundSummary = roundId => {
    const content = document.querySelector("#round-summary-content")
    const roundIndex = rounds.findIndex(round => Number(round.id) === Number(roundId))

    if (roundIndex < 0 || !isRoundClosed(rounds[roundIndex])) {
        content.hidden = true
        content.innerHTML = ""
        return
    }

    const round = rounds[roundIndex]
    const standings = getStandingsAfterRound(roundIndex)

    content.innerHTML = ""

    const title = document.createElement("h2")
    title.textContent = `${round.name} – výsledky po kole`

    const scroll = document.createElement("div")
    scroll.className = "table-scroll"

    const table = document.createElement("table")
    table.className = "round-summary-table"

    const thead = document.createElement("thead")
    const headerRow = document.createElement("tr")

    ;["Poradie po kole", "Meno", "Body v kole", "Celkovo po kole"].forEach(text => {
        const th = document.createElement("th")
        th.textContent = text
        headerRow.appendChild(th)
    })

    thead.appendChild(headerRow)

    const tbody = document.createElement("tbody")

    standings.forEach((player, index) => {
        const row = document.createElement("tr")

        const orderCell = document.createElement("td")
        orderCell.textContent = String(index + 1)

        const nameCell = document.createElement("td")
        nameCell.textContent = player.name

        const roundPointsCell = document.createElement("td")
        roundPointsCell.textContent = String(player.roundPoints)

        const cumulativeCell = document.createElement("td")
        cumulativeCell.textContent = String(player.cumulativePoints)

        row.append(orderCell, nameCell, roundPointsCell, cumulativeCell)
        tbody.appendChild(row)
    })

    table.append(thead, tbody)
    scroll.appendChild(table)
    content.append(title, scroll)
    content.hidden = false
}

const renderPositionChart = () => {
    const canvas = document.querySelector("#position-chart")
    if (!canvas || typeof Chart === "undefined") return

    if (positionChartInstance) {
        positionChartInstance.destroy()
        positionChartInstance = null
    }

    const closedRounds = getClosedRoundEntries()
    if (closedRounds.length === 0) return

    const labels = closedRounds.map(item => item.round.name)

    const datasets = players.map((player, playerIndex) => {
        const data = closedRounds.map(item => {
            const standings = getStandingsAfterRound(item.index)
            const position = standings.findIndex(
                standingPlayer => Number(standingPlayer.id) === Number(player.id)
            )

            return position >= 0 ? position + 1 : null
        })

        const color = getPlayerChartColor(playerIndex, players.length)

        return {
            label: player.name,
            data,
            borderColor: color,
            backgroundColor: color,
            tension: 0.15,
            pointRadius: 4,
            pointHoverRadius: 6
        }
    })

    positionChartInstance = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "nearest",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: "#e2e8f0"
                    }
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            return `${context.dataset.label}: ${context.parsed.y}. miesto`
                        }
                    }
                }
            },
            scales: {
                y: {
                    reverse: true,
                    min: 1,
                    max: Math.max(players.length, 1),
                    ticks: {
                        stepSize: 1,
                        precision: 0,
                        color: "#cbd5e1",
                        callback: value => `${value}.`
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.16)"
                    },
                    title: {
                        display: true,
                        text: "Poradie",
                        color: "#e2e8f0"
                    }
                },
                x: {
                    ticks: {
                        color: "#cbd5e1"
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.12)"
                    },
                    title: {
                        display: true,
                        text: "Kolo",
                        color: "#e2e8f0"
                    }
                }
            }
        }
    })
}

const renderPointsChart = () => {
    const canvas = document.querySelector("#points-chart")
    if (!canvas || typeof Chart === "undefined") return

    if (pointsChartInstance) {
        pointsChartInstance.destroy()
        pointsChartInstance = null
    }

    const closedRounds = getClosedRoundEntries()
    if (closedRounds.length === 0) return

    const labels = closedRounds.map(item => item.round.name)

    const datasets = players.map((player, playerIndex) => {
        const data = closedRounds.map(item => {
            return countPlayerPointsThroughRound(player.id, item.index)
        })

        const color = getPlayerChartColor(playerIndex, players.length)

        return {
            label: player.name,
            data,
            borderColor: color,
            backgroundColor: color,
            tension: 0.2,
            pointRadius: 4,
            pointHoverRadius: 6
        }
    })

    pointsChartInstance = new Chart(canvas, {
        type: "line",
        data: {
            labels,
            datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: "nearest",
                intersect: false
            },
            plugins: {
                legend: {
                    position: "bottom",
                    labels: {
                        color: "#e2e8f0"
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: "#cbd5e1"
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.16)"
                    },
                    title: {
                        display: true,
                        text: "Celkové body",
                        color: "#e2e8f0"
                    }
                },
                x: {
                    ticks: {
                        color: "#cbd5e1"
                    },
                    grid: {
                        color: "rgba(148, 163, 184, 0.12)"
                    },
                    title: {
                        display: true,
                        text: "Kolo",
                        color: "#e2e8f0"
                    }
                }
            }
        }
    })
}

const updateChartPanels = () => {
    const positionPanel = document.querySelector("#position-chart-panel")
    const pointsPanel = document.querySelector("#points-chart-panel")
    const positionButton = document.querySelector("#btn-position-chart")
    const pointsButton = document.querySelector("#btn-points-chart")

    const hasClosedRounds = getClosedRoundEntries().length > 0

    positionButton.disabled = !hasClosedRounds
    pointsButton.disabled = !hasClosedRounds

    positionPanel.hidden = activeChartType !== "position"
    pointsPanel.hidden = activeChartType !== "points"

    positionButton.classList.toggle(
        "analysis-button-active",
        activeChartType === "position"
    )

    pointsButton.classList.toggle(
        "analysis-button-active",
        activeChartType === "points"
    )

    if (activeChartType === "position" && hasClosedRounds) {
        requestAnimationFrame(renderPositionChart)
    }

    if (activeChartType === "points" && hasClosedRounds) {
        requestAnimationFrame(renderPointsChart)
    }
}

const renderSeasonAnalysis = () => {
    const buttonsContainer = document.querySelector("#round-summary-buttons")
    const content = document.querySelector("#round-summary-content")

    buttonsContainer.innerHTML = ""

    const closedRounds = getClosedRoundEntries()

    if (closedRounds.length === 0) {
        const info = document.createElement("p")
        info.className = "analysis-empty"
        info.textContent =
            "Po uzavretí prvého kola sa tu zobrazia výsledky po kolách a grafy."
        buttonsContainer.appendChild(info)

        selectedSummaryRoundId = null
        content.hidden = true
        content.innerHTML = ""
        activeChartType = null
        updateChartPanels()
        return
    }

    if (
        selectedSummaryRoundId !== null
        && !closedRounds.some(
            item => Number(item.round.id) === Number(selectedSummaryRoundId)
        )
    ) {
        selectedSummaryRoundId = null
    }

    closedRounds.forEach(item => {
        const button = document.createElement("button")
        button.type = "button"
        button.textContent = item.round.name

        const selected =
            Number(selectedSummaryRoundId) === Number(item.round.id)

        button.classList.toggle("round-summary-button-active", selected)

        button.addEventListener("click", () => {
            if (
                Number(selectedSummaryRoundId) === Number(item.round.id)
            ) {
                selectedSummaryRoundId = null
                renderSeasonAnalysis()
                return
            }

            selectedSummaryRoundId = item.round.id
            renderSeasonAnalysis()
        })

        buttonsContainer.appendChild(button)
    })

    if (selectedSummaryRoundId !== null) {
        renderRoundSummary(selectedSummaryRoundId)
    } else {
        content.hidden = true
        content.innerHTML = ""
    }

    updateChartPanels()
}

const renderAll = () => {
    updateControlsVisibility()
    renderPlayersTable()
    renderRoundsTable()
    renderAdminPanel()
    renderSeasonAnalysis()
    updateRoundCountdowns()
}

// =============================================================
// 9. REGISTRÁCIA A PRIHLÁSENIE
// =============================================================
const registerButton = document.querySelector("#btn-register")
const loginButton = document.querySelector("#btn-login")
const logoutButton = document.querySelector("#btn-logout")
const adminLoginButton = document.querySelector("#btn-admin-login")
const refreshButton = document.querySelector("#btn-refresh")

registerButton.addEventListener("click", async () => {
    const name = prompt("Zadaj svoje meno")
    if (!name) return

    const pin = prompt("Zadaj svoj PIN – minimálne 4 znaky")
    if (!pin) return

    try {
        await rpc("register_player", {
            p_name: name,
            p_pin: pin
        })

        await refreshAllData()
        alert("Registrácia bola úspešná. Čakáš na schválenie adminom.")
    } catch (error) {
        console.error("Registrácia zlyhala:", error)
        alert(getErrorMessage(error, "Registrácia zlyhala."))
    }
})

loginButton.addEventListener("click", async () => {
    const name = prompt("Zadaj meno")
    if (!name) return

    const pin = prompt("Zadaj PIN")
    if (!pin) return

    try {
        const player = await rpc("login_player", {
            p_name: name,
            p_pin: pin
        })

        if (!player.approved) {
            alert("Tvoj účet ešte čaká na schválenie adminom.")
            return
        }

        loggedPlayer = {
            id: Number(player.id),
            name: player.name,
            color: player.color,
            pin
        }

        isAdmin = false
        adminPinSession = null
        openedPlayers[loggedPlayer.id] = true

        await refreshAllData()
    } catch (error) {
        console.error("Prihlásenie zlyhalo:", error)
        alert(getErrorMessage(error, "Prihlásenie zlyhalo."))
    }
})

adminLoginButton.addEventListener("click", async () => {
    const pin = prompt("Zadaj admin PIN")
    if (!pin) return

    try {
        const valid = await rpc("admin_login", {
            p_pin: pin
        })

        if (!valid) {
            alert("Nesprávny admin PIN.")
            return
        }

        isAdmin = true
        adminPinSession = pin
        loggedPlayer = null

        await refreshAllData()
    } catch (error) {
        console.error("Admin prihlásenie zlyhalo:", error)
        alert(getErrorMessage(error, "Admin prihlásenie zlyhalo."))
    }
})

logoutButton.addEventListener("click", async () => {
    loggedPlayer = null
    isAdmin = false
    adminPinSession = null
    pendingPlayers = []

    await refreshAllData()
})

refreshButton.addEventListener("click", refreshAllData)

const positionChartButton = document.querySelector("#btn-position-chart")
const pointsChartButton = document.querySelector("#btn-points-chart")

positionChartButton.addEventListener("click", () => {
    activeChartType =
        activeChartType === "position"
            ? null
            : "position"

    updateChartPanels()
})

pointsChartButton.addEventListener("click", () => {
    activeChartType =
        activeChartType === "points"
            ? null
            : "points"

    updateChartPanels()
})

// =============================================================
// 10. ADMINISTRÁCIA HRY
// =============================================================
const addRoundButton = document.querySelector("#btn-round")
const resetButton = document.querySelector("#btn-reset")
const backupButton = document.querySelector("#btn-backup")
const restoreButton = document.querySelector("#btn-restore")
const backupFile = document.querySelector("#backup-file")

addRoundButton.addEventListener("click", async () => {
    if (!isAdmin && !loggedPlayer) {
        alert("Najprv sa musíš prihlásiť.")
        return
    }

    const nameInput = document.querySelector("#round-name")
    const deadlineInput = document.querySelector("#round-deadline")

    const name = nameInput.value.trim()
    const deadline = deadlineInput.value

    if (!name || !deadline) {
        alert("Vyplň názov kola aj čas uzávierky.")
        return
    }

    const deadlineIso = new Date(deadline).toISOString()

    try {
        if (isAdmin) {
            await rpc("add_round", {
                p_admin_pin: adminPinSession,
                p_name: name,
                p_deadline: deadlineIso
            })
        } else {
            await rpc("player_add_round", {
                p_player_id: loggedPlayer.id,
                p_pin: loggedPlayer.pin,
                p_name: name,
                p_deadline: deadlineIso
            })
        }

        nameInput.value = ""
        deadlineInput.value = ""

        await refreshAllData()
    } catch (error) {
        console.error("Pridanie kola zlyhalo:", error)
        alert(getErrorMessage(error, "Kolo sa nepodarilo pridať."))
    }
})

resetButton.addEventListener("click", async () => {
    if (!isAdmin || !adminPinSession) return

    const confirmed = confirm(
        "Naozaj chceš vymazať všetkých hráčov, kolá, zápasy aj tipy?"
    )

    if (!confirmed) return

    try {
        await rpc("reset_game", {
            p_admin_pin: adminPinSession
        })

        await refreshAllData()
        alert("Všetky dáta hry boli vymazané.")
    } catch (error) {
        console.error("Vymazanie zlyhalo:", error)
        alert(getErrorMessage(error, "Dáta sa nepodarilo vymazať."))
    }
})

backupButton.addEventListener("click", async () => {
    if (!isAdmin || !adminPinSession) return

    try {
        const backupData = await rpc("get_backup", {
            p_admin_pin: adminPinSession
        })

        const jsonString = JSON.stringify(backupData, null, 2)
        const blob = new Blob([jsonString], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const link = document.createElement("a")

        link.href = url
        link.download = `tipovacka-zaloha-${new Date().toISOString().slice(0, 10)}.json`
        link.click()

        URL.revokeObjectURL(url)
    } catch (error) {
        console.error("Záloha zlyhala:", error)
        alert(getErrorMessage(error, "Zálohu sa nepodarilo vytvoriť."))
    }
})

restoreButton.addEventListener("click", () => {
    if (!isAdmin || !adminPinSession) return
    backupFile.click()
})

backupFile.addEventListener("change", event => {
    const file = event.target.files?.[0]
    if (!file) return

    const reader = new FileReader()

    reader.onload = async loadEvent => {
        try {
            const backupData = JSON.parse(loadEvent.target.result)

            const confirmed = confirm(
                "Naozaj chceš obnoviť zálohu? Aktuálne dáta sa prepíšu."
            )

            if (!confirmed) return

            await rpc("restore_backup", {
                p_admin_pin: adminPinSession,
                p_backup: backupData
            })

            await refreshAllData()
            alert("Záloha bola úspešne obnovená.")
        } catch (error) {
            console.error("Obnova zálohy zlyhala:", error)
            alert(getErrorMessage(error, "Súbor zálohy nie je platný."))
        } finally {
            backupFile.value = ""
        }
    }

    reader.readAsText(file)
})

// =============================================================
// 11. AUTOMATICKÉ OBNOVENIE PRI NÁVRATE NA KARTU
// =============================================================
window.addEventListener("focus", () => {
    refreshAllData()
})

document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAllData()
})

// =============================================================
// 12. SPUSTENIE
// =============================================================
updateControlsVisibility()
startCountdownTimer()
refreshAllData()
