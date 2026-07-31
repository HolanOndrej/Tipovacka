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
let isLoading = false

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

const isRoundClosed = (round) => {
    if (!round.deadline) return false

    return new Date(round.deadline) <= new Date()
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

    players = Array.isArray(data?.players) ? data.players : []
    rounds = Array.isArray(data?.rounds) ? data.rounds : []
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

    rounds.forEach((round, roundIndex) => {
        const roundWrapper = document.createElement("section")
        roundWrapper.className = "round-card"

        const title = document.createElement("h2")
        title.textContent = round.name

        const deadlineText = document.createElement("p")
        deadlineText.textContent = `Uzávierka: ${
            round.deadline
                ? new Date(round.deadline).toLocaleString("sk-SK")
                : "nezadaná"
        }`

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

        toggleButton.addEventListener("click", () => {
            const isHidden = tableScroll.hidden
            tableScroll.hidden = !isHidden
            toggleButton.textContent = isHidden ? "Skryť" : "Zobraziť"
        })

        if (roundIndex !== rounds.length - 1) {
            tableScroll.hidden = true
            toggleButton.textContent = "Zobraziť"
        }

        const tableHead = document.createElement("thead")
        const firstHeaderRow = document.createElement("tr")
        const secondHeaderRow = document.createElement("tr")

        const matchHeader = document.createElement("th")
        matchHeader.textContent = "Zápas"
        matchHeader.rowSpan = 2

        const resultHeader = document.createElement("th")
        resultHeader.textContent = "Výsledok"
        resultHeader.rowSpan = 2

        firstHeaderRow.append(matchHeader, resultHeader)

        players.forEach(player => {
            const playerHeader = document.createElement("th")
            const isOpened = Boolean(openedPlayers[player.id])

            playerHeader.textContent = isOpened
                ? `▼ ${player.name}`
                : `▶ ${player.name}`

            playerHeader.colSpan = isOpened ? 2 : 1
            playerHeader.style.cursor = "pointer"
            playerHeader.style.backgroundColor = player.color || "#e2e8f0"
            playerHeader.style.color = "#0f172a"

            playerHeader.addEventListener("click", () => {
                openedPlayers[player.id] = !openedPlayers[player.id]
                renderAll()
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

            row.append(matchCell, resultCell)

            players.forEach(player => {
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
        const totalLabel = document.createElement("td")
        totalLabel.textContent = "Body v kole"
        totalLabel.colSpan = 2
        totalRow.appendChild(totalLabel)

        players.forEach(player => {
            const isOpened = Boolean(openedPlayers[player.id])
            const roundPoints = getRoundPoints(round, player.id)

            if (isOpened) {
                const emptyCell = document.createElement("td")
                emptyCell.textContent = "-"
                emptyCell.style.backgroundColor = player.color || "#e2e8f0"
                emptyCell.style.color = "#0f172a"

                const pointsCell = document.createElement("td")
                pointsCell.textContent = String(roundPoints)
                pointsCell.style.backgroundColor = player.color || "#e2e8f0"
                pointsCell.style.color = "#0f172a"

                totalRow.append(emptyCell, pointsCell)
            } else {
                const pointsCell = document.createElement("td")
                pointsCell.textContent = String(roundPoints)
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
        roundControls.append(toggleButton, addMatchButton, deleteRoundButton)

        roundWrapper.append(title, deadlineText, roundControls, tableScroll)
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
        return
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
}

const renderAll = () => {
    updateControlsVisibility()
    renderPlayersTable()
    renderRoundsTable()
    renderAdminPanel()
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
        alert("Vyplň názov kola aj uzávierku.")
        return
    }

    try {
        if (isAdmin) {
            await rpc("add_round", {
                p_admin_pin: adminPinSession,
                p_name: name,
                p_deadline: new Date(deadline).toISOString()
            })
        } else {
            await rpc("player_add_round", {
                p_player_id: loggedPlayer.id,
                p_pin: loggedPlayer.pin,
                p_name: name,
                p_deadline: new Date(deadline).toISOString()
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
refreshAllData()
