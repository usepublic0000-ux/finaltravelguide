import { GoogleGenAI, Type } from "@google/genai";
import { WeatherInfo, EmergencyInfo, TravelTip, AdvancedGuide, Trip } from "../types";

// Helper to initialize AI
const getAI = () => {
    const apiKey = import.meta.env.VITE_GOOGLE_API_KEY;
    if (!apiKey) {
        console.warn("API Key is missing. AI features will be disabled or mocked.");
        return null;
    }
    return new GoogleGenAI({ apiKey });
};

export const fetchDestinationInfo = async (destination: string, month: string, days: number): Promise<{
    currencyCode: string;
    exchangeRate: number;
    weather: WeatherInfo;
    dailyWeather: string[];
    guide: string;
    emergency: EmergencyInfo;
    tips: TravelTip[];
}> => {
    const ai = getAI();
    
    // Mock data if no API key is provided
    if (!ai) {
        return {
            currencyCode: "USD",
            exchangeRate: 32.5,
            weather: {
                summary: "API Key未設定，無法獲取即時天氣。",
                tempRange: "20°C - 25°C",
                rainChance: "30%"
            },
            dailyWeather: Array(days).fill("晴時多雲 24°C"),
            guide: "# 歡迎使用旅遊手冊\n\n請設定 API KEY 以獲取 AI 導覽功能。\n\n目前顯示為測試資料。",
            emergency: {
                police: "110",
                ambulance: "119",
                embassy: "駐外辦事處電話",
                hospital: "最近的大型醫院"
            },
            tips: [
                { category: 'visa', content: '請確認簽證需求' },
                { category: 'network', content: '建議購買當地 eSIM' },
                { category: 'taboo', content: '請遵守當地禮儀' }
            ]
        };
    }

    try {
        const model = "gemini-3-flash-preview";
        
        const prompt = `
        I am planning a trip to ${destination} in ${month} for ${days} days. 
        Please provide the following information in JSON format.
        IMPORTANT: All text content (summary, guide, tips, etc.) MUST be in Traditional Chinese (繁體中文).
        
        1. Local currency code.
        2. Estimated exchange rate from TWD.
        3. Typical weather summary for this month (in Traditional Chinese).
        4. A simplified daily weather forecast array for ${days} days (e.g. "晴時多雲 25°C").
        5. Emergency contact numbers (Police, Ambulance, Taiwan Embassy/Representative if applicable, Major Hospital Name).
        6. Travel tips including: Visa requirements, Network/SIM recommendations, Cultural Taboos/Contraband (in Traditional Chinese).
        7. A short markdown travel guide (in Traditional Chinese).
        `;

        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        currencyCode: { type: Type.STRING },
                        exchangeRate: { type: Type.NUMBER },
                        weather: {
                            type: Type.OBJECT,
                            properties: {
                                summary: { type: Type.STRING },
                                tempRange: { type: Type.STRING },
                                rainChance: { type: Type.STRING }
                            }
                        },
                        dailyWeather: { 
                            type: Type.ARRAY, 
                            items: { type: Type.STRING }
                        },
                        emergency: {
                            type: Type.OBJECT,
                            properties: {
                                police: { type: Type.STRING },
                                ambulance: { type: Type.STRING },
                                embassy: { type: Type.STRING },
                                hospital: { type: Type.STRING }
                            }
                        },
                        tips: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    category: { type: Type.STRING, enum: ['visa', 'network', 'taboo', 'other'] },
                                    content: { type: Type.STRING }
                                }
                            }
                        },
                        guide: { type: Type.STRING }
                    }
                }
            }
        });

        const text = response.text;
        if (!text) throw new Error("No response from AI");
        
        const data = JSON.parse(text);
        return data;

    } catch (error) {
        console.error("Gemini API Error:", error);
        throw error;
    }
};

export const analyzeItinerary = async (trip: Trip): Promise<AdvancedGuide> => {
    const ai = getAI();
    if (!ai) throw new Error("API Key required");

    // Construct itinerary string
    const itineraryText = (trip.itinerary || []).map(day => 
        `Day ${day.date}: ${(day.items || []).map(i => i.activity + (i.location ? ` at ${i.location}` : '')).join(', ')}`
    ).join('\n');

    try {
        const prompt = `
        You are a luxury travel magazine editor. Analyze the following itinerary for ${trip.destination}.
        
        Itinerary:
        ${itineraryText}

        Please provide a deep analysis and guide in Traditional Chinese (繁體中文) JSON format with 3 sections.
        Tone: Professional, Engaging, Helpful.
        
        1. **attractions**: For major spots mentioned in the itinerary (or very famous ones nearby), provide a "Deep Dive". 
           - 'description': Historical background, stories, or fun facts (Deep & Engaging).
           - 'photoSpots': 2-3 specific best angles or locations for photos.
           - 'restroomTip': Where are the nearest/free restrooms?
           - 'locationQuery': Name for Google Maps search.
           - 'tags': e.g. ["歷史", "必去", "世界遺產"]
           
        2. **restaurants**: Recommend top 10 local rated restaurants/cafes/street food suited for this trip (nearby the itinerary spots).
           - 'name': Restaurant name.
           - 'rating': e.g. "4.8" or "Google 4.5".
           - 'mustOrder': List of signature dishes (Must Eat).
           - 'description': Short review/why it's good.
           - 'locationQuery': Name for Google Maps search.
           - 'type': e.g. "Dinner", "Cafe", "Snack".
           
        3. **hiddenGems**: 3-5 Hidden spots, free views, or secret photo spots nearby the itinerary locations that tourists might miss.
           - 'name': Spot name.
           - 'description': Why it's a hidden gem.
           - 'photoSpots': Specific photo advice.
           - 'locationQuery': Name for Google Maps search.
        `;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: prompt,
            config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        attractions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    description: { type: Type.STRING },
                                    photoSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    restroomTip: { type: Type.STRING },
                                    locationQuery: { type: Type.STRING },
                                    tags: { type: Type.ARRAY, items: { type: Type.STRING } }
                                }
                            }
                        },
                        restaurants: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    rating: { type: Type.STRING },
                                    mustOrder: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    description: { type: Type.STRING },
                                    locationQuery: { type: Type.STRING },
                                    type: { type: Type.STRING }
                                }
                            }
                        },
                        hiddenGems: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    name: { type: Type.STRING },
                                    description: { type: Type.STRING },
                                    photoSpots: { type: Type.ARRAY, items: { type: Type.STRING } },
                                    locationQuery: { type: Type.STRING }
                                }
                            }
                        }
                    }
                }
            }
        });

        return JSON.parse(response.text || "{}");
    } catch (e) {
        console.error("Analysis Failed", e);
        throw e;
    }
};
