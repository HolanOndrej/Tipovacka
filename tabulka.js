// ==============================
// 1. PRIPOJENIE NA SUPABASE
// ==============================
const SUPABASE_URL = "https://uisokzgwgmtezxgrpdtc.supabase.co"
const SUPABASE_KEY = "sb_publishable_ZhVISeAmC1eQkikZGW3YtA_fPjyFnQF"

const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY)
// ==============================
// 2. HLAVNÉ DÁTA APLIKÁCIE
// ==============================
// HRACI a ICH TIPY
let players = {}

// SKUTOCNE VYSLEDKY

let seasson = [];

let loggedPlayerKey = null

let openedPlayers = {}

let isAdmin = false
const ADMIN_PIN = "951753"

const playerColors = [
    "#d4edff",
    "#d4ffd9",
    "#fff3b0",
    "#ffd6d6",
    "#e4d4ff",
    "#ffd9b3",
    "#d6fff5",
    "#f7d6ff"
]



// ==============================
// ULOŽENIE DÁT DO SUPABASE
// ==============================
const saveToStorage = async () => {
    const { data, error } = await supabaseClient
        .from("app_data")
        .update({
            players: players,
            seasson: seasson
        })
        .eq("id", "main")
        .select()

    if (error) {
        console.error("Chyba pri ukladaní:", error)
    } else {
        console.log("Uložené OK:", data)
    }
}

// ==============================
// NAČÍTANIE DÁT ZO SUPABASE
// ==============================
const loadFromStorage = async () => {
    const { data, error } = await supabaseClient
        .from("app_data")
        .select("players, seasson")
        .eq("id", "main")
        .maybeSingle()

    if (error) {
        console.error("Chyba pri načítaní:", error)
        return
    }

    if (data) {
        console.log("Načítané zo Supabase")
        players = data.players || {}
        seasson = data.seasson || []
    } else {
        console.log("Supabase je prázdny")
        players = {}
        seasson = []
    }
}

// ==============================
// ZISTENIE VÍŤAZA ZÁPASU: 1 / X / 2
// ==============================

const get1X2 = (match) => {
    
    if (match.home > match.away) {
        return 1 
    } else if (match.home === match.away){
        return "X"
    } else if (match.home < match.away){
        return 2
    }
}

// ==============================
// VÝPOČET BODOV ZA JEDEN ZÁPAS
// ==============================
const points = (match) => {
    const resultDiff = match.result.home - match.result.away;
    const myTipDiff = match.myTips.home - match.myTips.away;

    const resultPointsTwo = () => {
     return  match.result.home + match.result.away 
    }
    const myTipsPointsTwo = () => {
     return  match.myTips.home + match.myTips.away 
    }  

    if (match.result.home === match.myTips.home && match.result.away === match.myTips.away){
        return 10
    } else if(get1X2(match.result) === get1X2(match.myTips) && resultDiff === myTipDiff ){
        return 6
    }else if (get1X2(match.result) === get1X2(match.myTips) && resultPointsTwo() === myTipsPointsTwo()){
        return 6
    }else if (get1X2(match.result) === get1X2(match.myTips)){
        return 4
    }else if (resultPointsTwo() === myTipsPointsTwo()){
        return 2
    } else {
        return 0
    }
}
// ==============================
// VÝPOČET CELKOVÝCH BODOV HRÁČA
// ==============================
const countPlayerPoints = (player) => {
  let seassonPoints = 0;

  for (let roundIndex = 0; roundIndex < seasson.length; roundIndex++) {
    let roundPoints = 0

    for (let matchIndex = 0; matchIndex < seasson[roundIndex].matches.length; matchIndex++) {
      const myTips = player.tips?.[roundIndex]?.[matchIndex]?.myTips
      const result = seasson[roundIndex].matches[matchIndex].result

      if (!myTips) continue

      if (result.home === null || result.away === null) continue

      const matchObject = {
        name: seasson[roundIndex].matches[matchIndex].name,
        result: result,
        myTips: myTips
      }

      const matchPoints = points(matchObject)
      roundPoints += matchPoints
    }

    seassonPoints += roundPoints
  }

  return seassonPoints
}



// ==============================
// VYKRESLENIE HLAVNEJ TABUĽKY HRÁČOV
// ==============================
const renderPlayersTable = () => {
    const tBody = document.querySelector("#table-body")
    tBody.innerHTML = ""

    const table = Object.values(players).map(player => ({
        name: player.name,
        points: countPlayerPoints(player)
    }))

    table.sort((a, b) => b.points - a.points)

    table.forEach((player, index) => {
        const tr = document.createElement("tr")

        const tdOrder = document.createElement("td")
        tdOrder.textContent = index + 1

        const tdName = document.createElement("td")
        tdName.textContent = player.name

        const tdPoints = document.createElement("td")
        tdPoints.textContent = player.points

        tr.appendChild(tdOrder)
        tr.appendChild(tdName)
        tr.appendChild(tdPoints)

        tBody.appendChild(tr)
    })
}

// ==============================
// ULOŽENIE TIPU HRÁČA
// ==============================
const saveTip = async (playerKey, roundIndex, matchIndex, home, away) => {
    const deadline = seasson[roundIndex].deadline

    if (deadline && new Date() > new Date(deadline)) {
        alert("Tipovanie pre toto kolo je už uzavreté.")
        renderAll()
        return
    }

    if (home === "" || away === "") return

    const { data, error } = await supabaseClient
        .from("app_data")
        .select("players, seasson")
        .eq("id", "main")
        .maybeSingle()

    if (error) {
        console.error("Chyba pri načítaní aktuálnych dát:", error)
        return
    }

    const latestPlayers = data.players || {}
    const latestSeasson = data.seasson || []

    latestPlayers[playerKey].tips[roundIndex][matchIndex].myTips = {
        home: Number(home),
        away: Number(away)
    }

    const { error: updateError } = await supabaseClient
        .from("app_data")
        .update({
            players: latestPlayers,
            seasson: latestSeasson
        })
        .eq("id", "main")

    if (updateError) {
        console.error("Chyba pri ukladaní tipu:", updateError)
        return
    }

    players = latestPlayers
    seasson = latestSeasson

    renderAll()
}

// ==============================
// ULOŽENIE SKUTOČNÉHO VÝSLEDKU ZÁPASU
// ==============================
const saveResult = (roundIndex, matchIndex, home, away) => {
    if (home === "" || away === "") return

    seasson[roundIndex].matches[matchIndex].result = {
        home: Number(home),
        away: Number(away)
    }

    saveToStorage()
    renderAll()
}

// ==============================
// VYKRESLENIE TABULIEK JEDNOTLIVÝCH KÔL
// ==============================
const renderRoundsTable = () => {
    const tableRound = document.querySelector("#table-round")
    tableRound.innerHTML = ""

    seasson.forEach((round, roundIndex) => {
        // vytvorenie obalu pre jedno kolo
        const roundWrapper = document.createElement("div")

        // názov kola
        const title = document.createElement("h2")
        title.textContent = round.round

        // zobrazenie uzávierky kola
        const deadlineText = document.createElement("p")

        deadlineText.textContent =
            `Uzávierka: ${
                round.deadline
                    ? new Date(round.deadline)
                        .toLocaleString("sk-SK")
                    : "nezadaná"
            }`

        // tlačidlo na skrytie/zobrazenie tabuľky kola
        const toggleBtn = document.createElement("button")
        toggleBtn.textContent = "Skryť"

        // tlačidlo na pridanie zápasu do kola
        const addMatchBtn = document.createElement("button")
addMatchBtn.textContent = "Pridať zápas"

addMatchBtn.addEventListener("click", () => {
    const matchName = prompt("Zadaj zápas, napr. KE : SK")
    if (!matchName) return

    seasson[roundIndex].matches.push({
        name: matchName,
        result: {
            home: null,
            away: null
        }
    })

    Object.values(players).forEach(player => {
        player.tips[roundIndex].push({
            name: matchName,
            myTips: null
        })
    })

    saveToStorage()
    renderAll()
})
        // tlačidlo na odstránenie celého kola
        const deleteRoundBtn = document.createElement("button")
        deleteRoundBtn.textContent = "Odstrániť kolo"
            
        deleteRoundBtn.addEventListener("click", () => {
            const confirmDelete = confirm (`Naozaj chceš odstránit ${round.round}?`)
            if(!confirmDelete) return
            seasson.splice(roundIndex, 1)

            Object.values(players).forEach(player => {
                player.tips.splice(roundIndex, 1)
            })

            // seasson.forEach((round, index) => {
            //     round.round = `${index + 1}.kolo`
            // })

            saveToStorage()
            renderAll()
        })    

        // vytvorenie tabuľky pre jedno kolo
        const table = document.createElement("table")
            toggleBtn.addEventListener("click", () => {
                if (table.style.display === "none") {
                    table.style.display = "table"
                    toggleBtn.textContent = "Skryť"
                } else {
                    table.style.display = "none"
                    toggleBtn.textContent = "Zobraziť"
                }
            })

            if (roundIndex !== seasson.length - 1) {
                    table.style.display = "none"
                    toggleBtn.textContent = "Zobraziť"
                }
            
        // hlavička tabuľky
        const thead = document.createElement("thead")

        const tableRow1 = document.createElement("tr")

        const tableZapas = document.createElement("th")
        tableZapas.textContent = "Zápas"
        tableZapas.rowSpan = 2

        const tableVysledok = document.createElement("th")
        tableVysledok.textContent = "Výsledok"
        tableVysledok.rowSpan = 2

        tableRow1.appendChild(tableZapas)
        tableRow1.appendChild(tableVysledok)

        Object.entries(players).forEach(([playerKey, player]) => {
    const thPlayer = document.createElement("th")

    const isOpened = openedPlayers[playerKey]

    thPlayer.textContent = isOpened
        ? `▼ ${player.name}`
        : `▶ ${player.name}`

    thPlayer.colSpan = isOpened ? 2 : 1
    thPlayer.style.cursor = "pointer"
    thPlayer.style.backgroundColor = player.color || "#eee"

    thPlayer.addEventListener("click", () => {
        openedPlayers[playerKey] = !openedPlayers[playerKey]
        renderAll()
    })

    tableRow1.appendChild(thPlayer)
})

        const tableRow2 = document.createElement("tr")

        Object.entries(players).forEach(([playerKey, player]) => {
    const isOpened = openedPlayers[playerKey]

    if (isOpened) {
        const tableTipy = document.createElement("th")
        tableTipy.textContent = "Tip"
        tableTipy.style.backgroundColor = player.color || "#eee"

        const tableBody = document.createElement("th")
        tableBody.textContent = "Body"
        tableBody.style.backgroundColor = player.color || "#eee"

        tableRow2.appendChild(tableTipy)
        tableRow2.appendChild(tableBody)
    } else {
        const emptyTh = document.createElement("th")
        emptyTh.textContent = ""
        emptyTh.style.backgroundColor = player.color || "#eee"

        tableRow2.appendChild(emptyTh)
    }
})
        
        // telo tabuľky - sem pôjdu zápasy
        const tbody = document.createElement("tbody")
        
        // vytvorenie riadkov jednotlivých zápasov
        round.matches.forEach((match, matchIndex) => {
            const tr = document.createElement("tr")

            tr.style.cursor = "pointer"

            tr.addEventListener("click", () => {

    // odstráni glow zo všetkých riadkov
            document
                .querySelectorAll(".active-match-row")
                .forEach(row => {
                    row.classList.remove("active-match-row")
                    row.style.outline = ""
                    row.style.boxShadow = ""
                })

    // pridá glow aktuálnemu riadku
            tr.classList.add("active-match-row")

            tr.style.outline =
                "2px solid #00aaff"

            tr.style.boxShadow =
                "0 0 8px #00aaff, 0 0 18px #00aaff"
        })

            // bunka s názvom zápasu + tlačidlá upraviť/vymazať
            const tdMatch = document.createElement("td")
            
            const matchNameSpan = document.createElement("span")
            matchNameSpan.textContent = match.name

            const editMatchBtn = document.createElement("button")
            editMatchBtn.textContent = "Upraviť"

            editMatchBtn.addEventListener("click", () => {
                const newName = prompt("Zadaj nový názov", match.name)
                if (!newName) return

                seasson[roundIndex].matches[matchIndex].name = newName

                Object.values(players).forEach(player => {
                    player.tips[roundIndex][matchIndex].name = newName
                })
                saveToStorage()
                renderAll()
            })

            const deleteMatch = document.createElement ("button")
            deleteMatch.textContent = "Vymazať"
            deleteMatch.addEventListener("click", () => {
                const confirmDelete = confirm(`Naozaj chceš vymazať zápas ${match.name}?`)
                if (!confirmDelete) return

                seasson[roundIndex].matches.splice(matchIndex, 1)

                Object.values(players).forEach(player => {
                    player.tips[roundIndex].splice(matchIndex, 1)
                })
                saveToStorage()
                renderAll()
            })

            

            tdMatch.appendChild(matchNameSpan)
           
           if (loggedPlayerKey) {
             tdMatch.append(" ")
             tdMatch.appendChild(editMatchBtn)
             tdMatch.append(" ")
             tdMatch.appendChild(deleteMatch)
            }

            
           

           // bunka so skutočným výsledkom zápasu
           const tdResult = document.createElement("td")

        const resultHome = document.createElement("input")
        resultHome.type = "number"
        resultHome.value = match.result.home !== null ? match.result.home : ""
        resultHome.style.width = "40px"

        const resultAway = document.createElement("input")
        resultAway.type = "number"
        resultAway.value = match.result.away !== null ? match.result.away : ""
        resultAway.style.width = "40px"

        if (!loggedPlayerKey) {
            resultHome.disabled = true
            resultAway.disabled = true
        }

        resultHome.addEventListener("change", () => {
            saveResult(roundIndex, matchIndex, resultHome.value, resultAway.value)
        })

        resultAway.addEventListener("change", () => {
            saveResult(roundIndex, matchIndex, resultHome.value, resultAway.value)
        })

        tdResult.appendChild(resultHome)
        tdResult.append(" : ")
        tdResult.appendChild(resultAway)

            tr.appendChild(tdMatch)
            tr.appendChild(tdResult)

            // vytvorenie tipovacieho poľa pre každého hráča
            Object.entries(players).forEach(([playerKey, player]) => {
    const tip = player.tips?.[roundIndex]?.[matchIndex]?.myTips
    const isOpened = openedPlayers[playerKey]


    if (!isOpened) {
    const closedTd = document.createElement("td")
    closedTd.textContent = "▶"
    closedTd.style.textAlign = "center"
    closedTd.style.backgroundColor = player.color || "#eee"

    tr.appendChild(closedTd)
    return
    }

    const tdTip = document.createElement("td")
    const tdPoints = document.createElement("td")
    tdTip.style.backgroundColor =
        player.color || "#eee"

    tdPoints.style.backgroundColor =
        player.color || "#eee"

    const inputHome = document.createElement("input")
inputHome.type = "number"
inputHome.style.width = "40px"

const inputAway = document.createElement("input")
inputAway.type = "number"
inputAway.style.width = "40px"

// zistíme, či už deadline prešiel
const roundClosed =
    round.deadline && new Date() > new Date(round.deadline)

// zistíme, či tento stĺpec patrí prihlásenému hráčovi
const isMyTip =
    playerKey === loggedPlayerKey

// hodnoty zobrazíme iba:
// 1. vlastníkovi tipu pred deadline
// 2. všetkým po deadline
inputHome.value =
    (isMyTip || roundClosed) && tip
        ? tip.home
        : ""

inputAway.value =
    (isMyTip || roundClosed) && tip
        ? tip.away
        : ""

// ak to nie je môj tip a deadline ešte neprešiel,
// políčka zamkneme
if (!isMyTip && !roundClosed) {
    inputHome.disabled = true
    inputAway.disabled = true
}

// po deadline sa všetky tipy zamknú
if (roundClosed) {
    inputHome.disabled = true
    inputAway.disabled = true
}


    // elektrický efekt riadku
    inputHome.addEventListener("focus", () => {
        tr.style.outline = "2px solid #00aaff"
        tr.style.boxShadow =
            "0 0 8px #00aaff, 0 0 16px #00aaff"
        tr.style.transition =
            "all 0.15s ease"
    })

    inputAway.addEventListener("focus", () => {
        tr.style.outline = "2px solid #00aaff"
        tr.style.boxShadow =
            "0 0 8px #00aaff, 0 0 16px #00aaff"
        tr.style.transition =
            "all 0.15s ease"
    })

    inputHome.addEventListener("blur", () => {
        tr.style.outline = ""
        tr.style.boxShadow = ""
    })

    inputAway.addEventListener("blur", () => {
        tr.style.outline = ""
        tr.style.boxShadow = ""
    })

    inputHome.addEventListener("change", () => {
    saveTip(
        playerKey,
        roundIndex,
        matchIndex,
        inputHome.value,
        inputAway.value
    )
})

inputAway.addEventListener("change", () => {
    saveTip(
        playerKey,
        roundIndex,
        matchIndex,
        inputHome.value,
        inputAway.value
    )
})

    tdTip.appendChild(inputHome)
    tdTip.append(" : ")
    tdTip.appendChild(inputAway)

   if (
    roundClosed &&
    tip &&
    match.result.home !== null &&
    match.result.away !== null
) {
    tdPoints.textContent = points({
        result: match.result,
        myTips: tip
    })
} else {
    tdPoints.textContent = "0"
}

    tr.appendChild(tdTip)
    tr.appendChild(tdPoints)
})

            tbody.appendChild(tr)

            
        })
        // posledný riadok tabuľky - súčet bodov hráčov v danom kole
        // posledný riadok tabuľky - súčet bodov hráčov v danom kole
const totalRow = document.createElement("tr")

const totalText = document.createElement("td")
totalText.textContent = "Body v kole"
totalText.colSpan = 2

totalRow.appendChild(totalText)

Object.entries(players).forEach(([playerKey, player]) => {
    const isOpened = openedPlayers[playerKey]

    let roundPoints = 0

    round.matches.forEach((match, matchIndex) => {
        const tip =
            player.tips?.[roundIndex]?.[matchIndex]?.myTips

        if (
            !tip ||
            match.result.home === null ||
            match.result.away === null
        ) return

        roundPoints += points({
            result: match.result,
            myTips: tip
        })
    })

    if (isOpened) {
    const emptyTd = document.createElement("td")
    emptyTd.textContent = "-"
    emptyTd.style.backgroundColor =
        player.color || "#eee"

    const pointsTd = document.createElement("td")
    pointsTd.textContent = roundPoints
    pointsTd.style.backgroundColor =
        player.color || "#eee"

    totalRow.appendChild(emptyTd)
    totalRow.appendChild(pointsTd)

} else {
    const pointsTd = document.createElement("td")
    pointsTd.textContent = roundPoints
    pointsTd.style.backgroundColor =
        player.color || "#eee"

    totalRow.appendChild(pointsTd)
}
})



tbody.appendChild(totalRow)

        thead.appendChild(tableRow1)
        thead.appendChild(tableRow2)

        table.appendChild(thead)
        table.appendChild(tbody)

        roundWrapper.appendChild(title)
        roundWrapper.appendChild(deadlineText)
        roundWrapper.appendChild(toggleBtn)
        if (loggedPlayerKey) {
            roundWrapper.appendChild(addMatchBtn)
        }
        if (loggedPlayerKey) {
            roundWrapper.appendChild(deleteRoundBtn)
        }
        roundWrapper.appendChild(table)

        tableRound.appendChild(roundWrapper)
    })
}

// ==============================
// ADMIN PANEL
// ==============================
const renderAdminPanel = () => {
    adminPanel.innerHTML = ""

    if (!isAdmin) return

    const title = document.createElement("h2")
    title.textContent = "Čakajúce registrácie"

    adminPanel.appendChild(title)

    Object.entries(players).forEach(([playerKey, player]) => {

        // preskočí už schválených
        if (player.approved) return

        const div = document.createElement("div")

        const name = document.createElement("span")
        name.textContent = player.name

        const approveBtn =
            document.createElement("button")

        approveBtn.textContent =
            "Schváliť"

        approveBtn.addEventListener("click", () => {

            players[playerKey].approved = true

            saveToStorage()
            renderAll()
        })

        const deleteBtn =
            document.createElement("button")

        deleteBtn.textContent =
            "Zamietnuť"

        deleteBtn.addEventListener("click", () => {

            const confirmDelete = confirm(
                `Naozaj chceš zamietnuť hráča ${player.name}?`
            )

            if (!confirmDelete) return

            delete players[playerKey]

            saveToStorage()
            renderAll()
        })

        div.appendChild(name)
        div.append(" ")
        div.appendChild(approveBtn)
        div.append(" ")
        div.appendChild(deleteBtn)

        adminPanel.appendChild(div)
    })
}

// ==============================
// PREKRESLENIE CELEJ APLIKÁCIE
// ==============================
const renderAll = () => {
    renderPlayersTable()
    renderRoundsTable()
    renderAdminPanel()
}





// ==============================
// PRIDANIE NOVÉHO HRÁČA
// ==============================
// ==============================
// REGISTRÁCIA NOVÉHO HRÁČA
// ==============================
const btnRegister = document.querySelector("#btn-register")

btnRegister.addEventListener("click", async () => {
    const name = prompt("Zadaj svoje meno")
    if (!name) return

    const pin = prompt("Zadaj svoj PIN")
    if (!pin) return

    // 1. Najprv načítame najnovšie dáta zo Supabase
    const { data, error } = await supabaseClient
        .from("app_data")
        .select("players, seasson")
        .eq("id", "main")
        .maybeSingle()

    if (error) {
        console.error("Chyba pri načítaní dát:", error)
        alert("Registrácia zlyhala.")
        return
    }

    const latestPlayers = data.players || {}
    const latestSeasson = data.seasson || []

    // 2. Skontrolujeme, či meno už neexistuje
    const playerExists = Object.values(latestPlayers).some(player => {
        return player.name.toLowerCase() === name.toLowerCase()
    })

    if (playerExists) {
        alert("Meno už existuje. Zadaj iné meno.")
        return
    }

    // 3. Vytvoríme bezpečný nový playerKey
    const playerNumbers = Object.keys(latestPlayers).map(key => {
        return Number(key.replace("player", ""))
    })

    const maxNumber =
        playerNumbers.length > 0
            ? Math.max(...playerNumbers)
            : 0

    const newPlayerKey = "player" + (maxNumber + 1)

    // 4. Vytvoríme tipy podľa aktuálnych kôl a zápasov
    const newTips = latestSeasson.map(round => {
        return round.matches.map(match => {
            return {
                name: match.name,
                myTips: null
            }
        })
    })

    // 5. Pridáme nového hráča ako čakajúceho na schválenie
    latestPlayers[newPlayerKey] = {
        name: name,
        pin: pin,
        approved: false,
        tips: newTips
    }

    // 6. Uložíme späť najnovšie dáta
    const { error: updateError } = await supabaseClient
        .from("app_data")
        .update({
            players: latestPlayers,
            seasson: latestSeasson
        })
        .eq("id", "main")

    if (updateError) {
        console.error("Chyba pri registrácii:", updateError)
        alert("Registrácia zlyhala.")
        return
    }

    players = latestPlayers
    seasson = latestSeasson

    renderAll()

    alert("Registrácia úspešná. Čakáš na schválenie adminom.")
})

const btnLogin = document.querySelector("#btn-login")
const btnLogout = document.querySelector("#btn-logout")
const loginInfo = document.querySelector("#login-info")

btnLogin.addEventListener("click", () => {
    const name = prompt("Zadaj meno")
    if (!name) return

    const pin = prompt("Zadaj PIN")
    if (!pin) return

    const foundPlayerKey = Object.keys(players).find(playerKey => {
        return players[playerKey].name.toLowerCase() === name.toLowerCase() &&
               players[playerKey].pin === pin
    })

    if (!foundPlayerKey) {
        alert("Nesprávne meno alebo PIN")
        return
    }

    if (!players[foundPlayerKey].approved) {
    alert("Tvoj účet ešte čaká na schválenie adminom.")
    return
    }

    loggedPlayerKey = foundPlayerKey
    loginInfo.textContent = `Prihlásený: ${players[loggedPlayerKey].name}`

    renderAll()
})

btnLogout.addEventListener("click", () => {
    loggedPlayerKey = null
    loginInfo.textContent = "Nikto nie je prihlásený"

    renderAll()
})

// ==============================
// PRIDANIE NOVÉHO KOLA
// ==============================
const btnRound = document.querySelector("#btn-round")

btnRound.addEventListener("click", () => {

    if (!loggedPlayerKey) {
        alert("Najprv sa musíš prihlásiť.")
        return
    }

    const roundName =
        document.querySelector("#round-name").value

    const deadline =
        document.querySelector("#round-deadline").value

    if (!roundName || !deadline) {
        alert("Vyplň názov kola aj uzávierku")
        return
    }

    const newRound = {
        round: roundName,
        deadline: deadline,
        matches: []
    }

    seasson.push(newRound)

    Object.values(players).forEach(player => {
        player.tips.push([])
    })

    saveToStorage()
    renderAll()

    // vyčistí inputy
    document.querySelector("#round-name").value = ""
    document.querySelector("#round-deadline").value = ""
})

const btnReset = document.querySelector("#btn-reset")

if (btnReset) {
    btnReset.addEventListener("click", () => {
        if (!loggedPlayerKey) {
    alert("Najprv sa musíš prihlásiť.")
    return
}
        const confirmReset = confirm(
            "Naozaj chceš vymazať všetkých hráčov aj všetky kolá?"
        )

        if (!confirmReset) return

        players = {}
        seasson = []
        loggedPlayerKey = null

        saveToStorage()
        renderAll()

        alert("Všetko bolo vymazané")
    })

const btnBackup =
    document.querySelector("#btn-backup")

btnBackup.addEventListener("click", () => {

    const backupData = {
        players: players,
        seasson: seasson
    }

    const jsonString =
        JSON.stringify(backupData, null, 2)

    const blob = new Blob(
        [jsonString],
        { type: "application/json" }
    )

    const url =
        URL.createObjectURL(blob)

    const a =
        document.createElement("a")

    a.href = url
    a.download = "tipovacka-zaloha.json"

    a.click()

    URL.revokeObjectURL(url)
})

const btnRestore =
    document.querySelector("#btn-restore")

const backupFile =
    document.querySelector("#backup-file")

// po kliknutí otvorí výber súboru
btnRestore.addEventListener("click", () => {
    backupFile.click()
})

// po vybraní súboru
backupFile.addEventListener("change", (event) => {

    const file =
        event.target.files[0]

    if (!file) return

    const reader =
        new FileReader()

    reader.onload = async (e) => {
        try {

            const backupData =
                JSON.parse(e.target.result)

            const confirmRestore = confirm(
                "Naozaj chceš obnoviť zálohu? Prepíše aktuálne dáta."
            )

            if (!confirmRestore) return

            players =
                backupData.players || {}

            seasson =
                backupData.seasson || []

            await saveToStorage()

            renderAll()

            alert("Záloha úspešne obnovená")

        } catch (error) {

            alert(
                "Neplatný súbor zálohy."
            )

            console.error(error)
        }
    }

    reader.readAsText(file)
})
}

const btnAdminLogin = document.querySelector("#btn-admin-login")
const adminPanel = document.querySelector("#admin-panel")

btnAdminLogin.addEventListener("click", () => {
    const pin = prompt("Zadaj admin PIN")
    if (!pin) return

    if (pin !== ADMIN_PIN) {
        alert("Nesprávny admin PIN")
        return
    }

    isAdmin = true
    loggedPlayerKey = null
    loginInfo.textContent = "Prihlásený: ADMIN"

    renderAll()
})
  

    
// ==============================
// SPUSTENIE APLIKÁCIE
// ==============================
const startApp = async () => {
    await loadFromStorage()
    renderAll()
}

startApp()





