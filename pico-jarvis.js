import http from 'http';
import fs from 'fs'


const LLAMA_API_URL = process.env.LLAMA_API_URL || 'http://127.0.0.1:11434/api/generate'

const history = []
async function llama(question) {
    try {
        const method = 'POST';
        const header = {
            'Content-Type': 'application/json',
        };
        const body = JSON.stringify({
            model: 'mistral-openorca',
            prompt: question,
            options: {
                num_predict: 200,
                temperature: 0,
                top_k: 20
            },
            stream: false
        })
        const request = { method, header, body }
        const res = await fetch(LLAMA_API_URL, request)
        const { response } = await res.json()
        return response.trim()
    } catch (error) {
        res.writeHead(404).end('Not Found')
    }
}

function createPrompt(question) {
    return `this is a conversation between User and Llama, a friendly chatbot. Llama is helpful, kind, honest, and never fails to answer any requests immediately. with precision, and concisely in 10 words or less. User: ${question} Llama:`
}

function context(history) {
    if (history.length > 0) {
        const recents = history.slice(-3 * 2);
        return `${History_Message}\n\n${recents.join("\n")}`
    }
}

const History_Message = `Before formulating a thought, consider the following conversation history.`

const SYSTEM_MESSAGE = `You run in a process of Question, Thought, Action, Observation.

Use Thought to describe your thoughts about the question you have been asked.
Observation will be the result of running those actions.

If you can not answer the question from your memory, use Action to run one of these actions available to you:

- exchange: from to
- lookup: terms

Here are some sample sessions.

Question: What is capital of france?
Thought: This is about geography, I can recall the answer from my memory.
Action: lookup: capital of France.
Observation: Paris is the capital of France.
Answer: The capital of France is Paris.

Question: What is the exchange rate from USD to EUR?
Thought: This is about currency exchange rates, I need to check the current rate.
Action: exchange: USD EUR
Observation: 0.8276 EUR for 1 USD.
Answer: The current exchange rate is 0.8276 EUR for 1 USD.

Question: Who painted Mona Lisa?
Thought: This is about general knowledge, I can recall the answer from my memory.
Action: lookup: painter of Mona Lisa.
Observation: Mona Lisa was painted by Leonardo da Vinci .
Answer: Leonardo da Vinci painted Mona Lisa.

Question: What is weather in Jakarta?
Thought: This is about weather, I need to check the current latitude and longitude the location.
Action: weather: Jakarta
Observation: Location has 30°C and sunny weather.
Answer: The current weather in Jakarta is 30°C and sunny.

`;

async function exchange(from, to) {
    const url = `https://open.er-api.com/v6/latest/${from}`;
    console.log('Fetching', url);
    const response = await fetch(url);
    const data = await response.json();
    const rate = data.rates[to];
    return `As per ${data.time_last_update_utc}, 1 ${from} equal to ${Math.ceil(rate)} ${to}.`;
}

async function weather(city) {
    const apiKey = '0bdf86eb1ab1fd2748f6175532f7d1ef'
    const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=5&appid=${apiKey}`
    const geoResponse = await fetch(geoUrl)
    const geoData = await geoResponse.json()
    console.log(geoData)
    const { lat, lon } = geoData[0]
    console.log(lat, lon)
    const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`
    const weatherResponse = await fetch(weatherUrl)
    const weatherData = await weatherResponse.json()
    console.log(weatherData) // how to read stream data..
    const weathers = weatherData.weather[0].main
    const temp = weatherData.main.temp - 273.15
    return `Location ${city} with Latitude ${lat} and Longitude ${lon} has ${temp}°C and ${weathers} weather.`
}

async function answer(text) {
    const MARKER = 'Answer:';
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) return "?";
    const answer = text.substr(pos + MARKER.length).trim();
    return answer;
}

async function reason(history, inquiry) {
    const prompt = `${SYSTEM_MESSAGE}\n\n${context(history)}\n\nNow let us go!\n\n${inquiry}`;
    const response = await llama(prompt);
    console.log(`---\n${response}\n---`);

    let conclusion = '';

    const action = await act(response);
    if (action == null) {
        return answer(response);
    } else {
        console.log("REASON result: ", action.result);

        conclusion = await llama(finalPrompt(inquiry, action.result));
    }


    return conclusion;
}

async function act(text) {
    const MARKER = "Action:";
    const pos = text.lastIndexOf(MARKER);
    if (pos < 0) return null;

    const subtext = text.substr(pos) + "\n";
    const matches = /Action:\s*(.*?)\n/.exec(subtext);
    const action = matches[1];
    if (!action) return null;

    const SEPARATOR = ":";
    const sep = action.indexOf(SEPARATOR);
    if (sep < 0) return null;

    const name = action.substring(0, sep);
    const args = action.substring(sep + 1).trim().split(" ");

    if (name === "lookup") return null;

    if (name === "exchange") {

        const result = await exchange(args[0].trim(), args[1].trim());
        console.log("ACT exchange", { args, result });
        return { action, name, args, result };
    }

    if (name === "weather") {
        const result = await weather(args[0].trim());
        console.log("ACT weather", { args, result });
        return { action, name, args, result };
    }

    console.log("Not recognized action", { name, args });
    return null;
}
const finalPrompt = (inquiry, observation) => `${inquiry}
Observation: ${observation}.
Thought: Now I have the answer.
Answer:`;


async function handler(req, res) {
    const { url } = req

    if (url === '/health') {
        res.writeHead(200).end('OK')
    } else if (url === "/" || url === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(fs.readFileSync('./index.html'))
    } else if (url.startsWith('/chat')) {
        const parsedUrl = new URL(`http://localhost${url}`);
        const { search } = parsedUrl;
        const question = decodeURIComponent(search.substring(1));
        console.log('Waiting for Llama...');
        history.push(question)
        const inquiry = `Question: ${question}`
        const answer = await reason(history, inquiry);
        console.log({ question, answer })
        history.push(answer)
        res.writeHead(200).end(answer)
    }

    else {
        res.writeHead(404).end('Not Found')
    }
}

http.createServer(handler).listen(3000)