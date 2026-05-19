const express = require('express');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 5000;

const API_URL = 'https://sun-ls.onrender.com/sunlon';
const LEARNING_FILE = 'learning_data.json';
const HISTORY_FILE = 'prediction_history.json';

let predictionHistory = {
  b52: []
};

const MAX_HISTORY = 100;
const AUTO_SAVE_INTERVAL = 5000;
let lastProcessedPhien = { b52: null };

let learningData = {
  b52: {
    predictions: [],
    patternStats: {},
    totalPredictions: 0,
    correctPredictions: 0,
    patternWeights: {},
    lastUpdate: null,
    streakAnalysis: { wins: 0, losses: 0, currentStreak: 0, bestStreak: 0, worstStreak: 0 },
    adaptiveThresholds: {},
    recentAccuracy: [],
    reversalState: {
      active: false,
      activatedAt: null,
      consecutiveLosses: 0,
      reversalCount: 0,
      lastReversalResult: null
    },
    transitionMatrix: {
      'Tài->Tài': 0, 'Tài->Xỉu': 0,
      'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0
    }
  }
};

const DEFAULT_PATTERN_WEIGHTS = {
  'cau_bet': 1.3,
  'cau_dao_11': 1.2,
  'cau_22': 1.15,
  'cau_33': 1.2,
  'cau_121': 1.1,
  'cau_123': 1.1,
  'cau_321': 1.1,
  'cau_nhay_coc': 1.0,
  'cau_nhip_nghieng': 1.15,
  'cau_3van1': 1.2,
  'cau_be_cau': 1.25,
  'cau_chu_ky': 1.1,
  'distribution': 0.9,
  'dice_pattern': 1.0,
  'sum_trend': 1.05,
  'edge_cases': 1.1,
  'momentum': 1.15,
  'cau_tu_nhien': 0.8,
  'dice_trend_line': 1.2,
  'break_pattern': 1.3,
  'fibonacci': 1.0,
  'resistance_support': 1.15,
  'wave': 1.1,
  'golden_ratio': 1.0,
  'day_gay': 1.25,
  'cau_44': 1.2,
  'cau_55': 1.25,
  'cau_212': 1.1,
  'cau_1221': 1.15,
  'cau_2112': 1.15,
  'cau_gap': 1.1,
  'cau_ziczac': 1.2,
  'cau_doi': 1.15,
  'cau_rong': 1.3,
  'smart_bet': 1.2,
  'markov_chain': 1.35,
  'moving_avg_drift': 1.2,
  'sum_pressure': 1.25,
  'volatility': 1.15,
  'sun_hot_cold': 1.3,
  'sun_streak_break': 1.35,
  'sun_balance': 1.2,
  'sun_momentum_shift': 1.25
};

const REVERSAL_THRESHOLD = 3;

function loadLearningData() {
  try {
    if (fs.existsSync(LEARNING_FILE)) {
      const data = fs.readFileSync(LEARNING_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.b52) {
        learningData = { ...learningData, ...parsed };
      }
      console.log('Learning data loaded successfully');
    }
  } catch (error) {
    console.error('Error loading learning data:', error.message);
  }
}

function saveLearningData() {
  try {
    fs.writeFileSync(LEARNING_FILE, JSON.stringify(learningData, null, 2));
  } catch (error) {
    console.error('Error saving learning data:', error.message);
  }
}

function loadPredictionHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = fs.readFileSync(HISTORY_FILE, 'utf8');
      const parsed = JSON.parse(data);
      if (parsed.history && parsed.history.b52) {
        predictionHistory = parsed.history;
      } else {
        predictionHistory = { b52: [] };
      }
      if (parsed.lastProcessedPhien && parsed.lastProcessedPhien.b52) {
        lastProcessedPhien = parsed.lastProcessedPhien;
      } else {
        lastProcessedPhien = { b52: null };
      }
      console.log('Prediction history loaded successfully');
      console.log(`  - Sun: ${predictionHistory.b52.length} records`);
    }
  } catch (error) {
    console.error('Error loading prediction history:', error.message);
  }
}

function savePredictionHistory() {
  try {
    const dataToSave = {
      history: predictionHistory,
      lastProcessedPhien,
      lastSaved: new Date().toISOString()
    };
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving prediction history:', error.message);
  }
}

async function autoProcessPredictions() {
  try {
    const data = await fetchData();
    if (!data || !data.data || data.data.length === 0) return;
    
    const latestPhien = data.data[0].Phien;
    const nextPhien = latestPhien + 1;
    
    if (lastProcessedPhien.b52 !== nextPhien) {
      await verifyPredictions('b52', data.data);
      
      const result = calculateAdvancedPrediction(data.data, 'b52');
      savePredictionToHistory('b52', nextPhien, result.prediction, result.confidence);
      recordPrediction('b52', nextPhien, result.prediction, result.confidence, result.factors);
      
      lastProcessedPhien.b52 = nextPhien;
      console.log(`[Auto] Sun phien ${nextPhien}: ${result.prediction} (${result.confidence}%)`);
    }
    
    savePredictionHistory();
    saveLearningData();
    
  } catch (error) {
    console.error('[Auto] Error processing predictions:', error.message);
  }
}

function startAutoSaveTask() {
  console.log(`Auto-save task started (every ${AUTO_SAVE_INTERVAL/1000}s)`);
  
  setTimeout(() => {
    autoProcessPredictions();
  }, 5000);
  
  setInterval(() => {
    autoProcessPredictions();
  }, AUTO_SAVE_INTERVAL);
}

function initializePatternStats(type) {
  if (!learningData[type].patternWeights || Object.keys(learningData[type].patternWeights).length === 0) {
    learningData[type].patternWeights = { ...DEFAULT_PATTERN_WEIGHTS };
  }
  
  Object.keys(DEFAULT_PATTERN_WEIGHTS).forEach(pattern => {
    if (!learningData[type].patternStats[pattern]) {
      learningData[type].patternStats[pattern] = {
        total: 0,
        correct: 0,
        accuracy: 0.5,
        recentResults: [],
        lastAdjustment: null
      };
    }
  });
}

function getPatternWeight(type, patternId) {
  initializePatternStats(type);
  return learningData[type].patternWeights[patternId] || 1.0;
}

function updatePatternPerformance(type, patternId, isCorrect) {
  initializePatternStats(type);
  
  const stats = learningData[type].patternStats[patternId];
  if (!stats) return;
  
  stats.total++;
  if (isCorrect) stats.correct++;
  
  stats.recentResults.push(isCorrect ? 1 : 0);
  if (stats.recentResults.length > 20) {
    stats.recentResults.shift();
  }
  
  const recentAccuracy = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
  stats.accuracy = stats.total > 0 ? stats.correct / stats.total : 0.5;
  
  const oldWeight = learningData[type].patternWeights[patternId];
  let newWeight = oldWeight;
  
  if (stats.recentResults.length >= 5) {
    if (recentAccuracy > 0.6) {
      newWeight = Math.min(2.0, oldWeight * 1.05);
    } else if (recentAccuracy < 0.4) {
      newWeight = Math.max(0.3, oldWeight * 0.95);
    }
  }
  
  learningData[type].patternWeights[patternId] = newWeight;
  stats.lastAdjustment = new Date().toISOString();
}

function recordPrediction(type, phien, prediction, confidence, patterns) {
  const record = {
    phien: phien.toString(),
    prediction,
    confidence,
    patterns,
    timestamp: new Date().toISOString(),
    verified: false,
    actual: null,
    isCorrect: null
  };
  
  learningData[type].predictions.unshift(record);
  learningData[type].totalPredictions++;
  
  if (learningData[type].predictions.length > 500) {
    learningData[type].predictions = learningData[type].predictions.slice(0, 500);
  }
  
  saveLearningData();
}

async function verifyPredictions(type, currentData) {
  let updated = false;
  
  for (const pred of learningData[type].predictions) {
    if (pred.verified) continue;
    
    const actualResult = currentData.find(d => d.Phien.toString() === pred.phien);
    if (actualResult) {
      pred.verified = true;
      pred.actual = actualResult.Ket_qua;
      
      const predictedNormalized = pred.prediction === 'Tài' || pred.prediction === 'tai' ? 'Tài' : 'Xỉu';
      pred.isCorrect = pred.actual === predictedNormalized;
      
      if (pred.isCorrect) {
        learningData[type].correctPredictions++;
        learningData[type].streakAnalysis.wins++;
        
        if (learningData[type].streakAnalysis.currentStreak >= 0) {
          learningData[type].streakAnalysis.currentStreak++;
        } else {
          learningData[type].streakAnalysis.currentStreak = 1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak > learningData[type].streakAnalysis.bestStreak) {
          learningData[type].streakAnalysis.bestStreak = learningData[type].streakAnalysis.currentStreak;
        }
        
        updateReversalState(type, true);
      } else {
        learningData[type].streakAnalysis.losses++;
        
        if (learningData[type].streakAnalysis.currentStreak <= 0) {
          learningData[type].streakAnalysis.currentStreak--;
        } else {
          learningData[type].streakAnalysis.currentStreak = -1;
        }
        
        if (learningData[type].streakAnalysis.currentStreak < learningData[type].streakAnalysis.worstStreak) {
          learningData[type].streakAnalysis.worstStreak = learningData[type].streakAnalysis.currentStreak;
        }
        
        updateReversalState(type, false);
      }
      
      learningData[type].recentAccuracy.push(pred.isCorrect ? 1 : 0);
      if (learningData[type].recentAccuracy.length > 50) {
        learningData[type].recentAccuracy.shift();
      }
      
      if (pred.patterns && pred.patterns.length > 0) {
        pred.patterns.forEach(patternName => {
          const patternId = getPatternIdFromName(patternName);
          if (patternId) {
            updatePatternPerformance(type, patternId, pred.isCorrect);
          }
        });
      }
      
      updated = true;
    }
  }
  
  if (updated) {
    learningData[type].lastUpdate = new Date().toISOString();
    saveLearningData();
  }
}

function getPatternIdFromName(name) {
  const mapping = {
    'Cầu Bệt': 'cau_bet',
    'Cầu Đảo 1-1': 'cau_dao_11',
    'Cầu 2-2': 'cau_22',
    'Cầu 3-3': 'cau_33',
    'Cầu 4-4': 'cau_44',
    'Cầu 5-5': 'cau_55',
    'Cầu 1-2-1': 'cau_121',
    'Cầu 1-2-3': 'cau_123',
    'Cầu 3-2-1': 'cau_321',
    'Cầu 2-1-2': 'cau_212',
    'Cầu 1-2-2-1': 'cau_1221',
    'Cầu 1-2-1-2-1': 'cau_1221',
    'Cầu 2-1-1-2': 'cau_2112',
    'Cầu Nhảy Cóc': 'cau_nhay_coc',
    'Cầu Nhịp Nghiêng': 'cau_nhip_nghieng',
    'Cầu 3 Ván 1': 'cau_3van1',
    'Cầu Bẻ Cầu': 'cau_be_cau',
    'Cầu Chu Kỳ': 'cau_chu_ky',
    'Cầu Gấp': 'cau_gap',
    'Cầu Ziczac': 'cau_ziczac',
    'Cầu Đôi': 'cau_doi',
    'Cầu Rồng': 'cau_rong',
    'Đảo Xu Hướng': 'smart_bet',
    'Xu Hướng Cực': 'smart_bet',
    'Phân bố': 'distribution',
    'Tổng TB': 'dice_pattern',
    'Xu hướng': 'sum_trend',
    'Cực Điểm': 'edge_cases',
    'Biến động': 'momentum',
    'Cầu Tự Nhiên': 'cau_tu_nhien',
    'Biểu Đồ Đường': 'dice_trend_line',
    'Cầu Liên Tục': 'break_pattern',
    'Dây Gãy': 'day_gay'
  };
  
  for (const [key, value] of Object.entries(mapping)) {
    if (name.includes(key)) return value;
  }
  return null;
}

function getAdaptiveConfidenceBoost(type) {
  const recentAcc = learningData[type].recentAccuracy;
  if (recentAcc.length < 10) return 0;
  
  const accuracy = recentAcc.reduce((a, b) => a + b, 0) / recentAcc.length;
  
  if (accuracy > 0.65) return 5;
  if (accuracy > 0.55) return 2;
  if (accuracy < 0.4) return -5;
  if (accuracy < 0.45) return -2;
  
  return 0;
}

function getSmartPredictionAdjustment(type, prediction, patterns) {
  const streakInfo = learningData[type].streakAnalysis;
  
  if (streakInfo.currentStreak <= -5) {
    return prediction === 'Tài' ? 'Xỉu' : 'Tài';
  }
  
  let taiPatternScore = 0;
  let xiuPatternScore = 0;
  
  patterns.forEach(p => {
    const patternId = getPatternIdFromName(p.name || p);
    if (patternId) {
      const stats = learningData[type].patternStats[patternId];
      if (stats && stats.recentResults.length >= 5) {
        const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
        const weight = learningData[type].patternWeights[patternId] || 1;
        
        if (p.prediction === 'Tài') {
          taiPatternScore += recentAcc * weight;
        } else {
          xiuPatternScore += recentAcc * weight;
        }
      }
    }
  });
  
  if (Math.abs(taiPatternScore - xiuPatternScore) > 0.5) {
    return taiPatternScore > xiuPatternScore ? 'Tài' : 'Xỉu';
  }
  
  return prediction;
}

function normalizeResult(result) {
  if (result === 'Tài' || result === 'tài') return 'tai';
  if (result === 'Xỉu' || result === 'xỉu') return 'xiu';
  return result.toLowerCase();
}

async function fetchData() {
  try {
    const response = await axios.get(API_URL);
    const rawData = response.data;
    
    if (rawData && rawData.lich_su_phien) {
      const currentPhien = {
        Phien: rawData.phien_hien_tai,
        Ket_qua: rawData.ket_qua,
        xuc_xac_1: rawData.xuc_xac_1,
        xuc_xac_2: rawData.xuc_xac_2,
        xuc_xac_3: rawData.xuc_xac_3,
        tong: rawData.tong
      };
      
      const historyData = rawData.lich_su_phien.map(item => ({
        Phien: item.phien,
        Ket_qua: item.ket_qua,
        xuc_xac_1: item.xuc_xac_1,
        xuc_xac_2: item.xuc_xac_2,
        xuc_xac_3: item.xuc_xac_3,
        tong: item.tong
      }));
      
      return { data: [currentPhien, ...historyData] };
    }
    
    return response.data;
  } catch (error) {
    console.error('Error fetching data:', error.message);
    return null;
  }
}

function analyzeCauBet(results, type) {
  if (results.length < 3) return { detected: false };
  
  let streakType = results[0];
  let streakLength = 1;
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === streakType) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 3) {
    const weight = getPatternWeight(type, 'cau_bet');
    const stats = learningData[type].patternStats['cau_bet'];
    
    let shouldBreak = streakLength >= 6;
    
    if (stats && stats.recentResults.length >= 5) {
      const recentAcc = stats.recentResults.reduce((a, b) => a + b, 0) / stats.recentResults.length;
      if (recentAcc < 0.4) {
        shouldBreak = !shouldBreak;
      }
    }
    
    return { 
      detected: true, 
      type: streakType, 
      length: streakLength,
      prediction: shouldBreak ? (streakType === 'Tài' ? 'Xỉu' : 'Tài') : streakType,
      confidence: Math.round((shouldBreak ? Math.min(12, streakLength * 2) : Math.min(15, streakLength * 3)) * weight),
      name: `Cầu Bệt ${streakLength} phiên`,
      patternId: 'cau_bet'
    };
  }
  
  return { detected: false };
}

function analyzeCauDao11(results, type) {
  if (results.length < 4) return { detected: false };
  
  let alternatingLength = 1;
  for (let i = 1; i < Math.min(results.length, 10); i++) {
    if (results[i] !== results[i - 1]) {
      alternatingLength++;
    } else {
      break;
    }
  }
  
  if (alternatingLength >= 4) {
    const weight = getPatternWeight(type, 'cau_dao_11');
    return { 
      detected: true, 
      length: alternatingLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(14, alternatingLength * 2 + 4) * weight),
      name: `Cầu Đảo 1-1 (${alternatingLength} phiên)`,
      patternId: 'cau_dao_11'
    };
  }
  
  return { detected: false };
}

function analyzeCau22(results, type) {
  if (results.length < 6) return { detected: false };
  
  let pairCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 1 && pairCount < 4) {
    if (results[i] === results[i + 1]) {
      pattern.push(results[i]);
      pairCount++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairCount >= 2) {
    let isAlternating = true;
    for (let j = 1; j < pattern.length; j++) {
      if (pattern[j] === pattern[j - 1]) {
        isAlternating = false;
        break;
      }
    }
    
    if (isAlternating) {
      const lastPairType = pattern[pattern.length - 1];
      const weight = getPatternWeight(type, 'cau_22');
      
      return { 
        detected: true, 
        pairCount,
        prediction: lastPairType === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairCount * 3 + 3) * weight),
        name: `Cầu 2-2 (${pairCount} cặp)`,
        patternId: 'cau_22'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau33(results, type) {
  if (results.length < 6) return { detected: false };
  
  let tripleCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 2) {
    if (results[i] === results[i + 1] && results[i + 1] === results[i + 2]) {
      pattern.push(results[i]);
      tripleCount++;
      i += 3;
    } else {
      break;
    }
  }
  
  if (tripleCount >= 1) {
    const currentPosition = results.length % 3;
    const lastTripleType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_33');
    
    let prediction;
    if (currentPosition === 0) {
      prediction = lastTripleType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastTripleType;
    }
    
    return { 
      detected: true, 
      tripleCount,
      prediction,
      confidence: Math.round(Math.min(13, tripleCount * 4 + 5) * weight),
      name: `Cầu 3-3 (${tripleCount} bộ ba)`,
      patternId: 'cau_33'
    };
  }
  
  return { detected: false };
}

function analyzeCau121(results, type) {
  if (results.length < 4) return { detected: false };
  
  const pattern1 = results.slice(0, 4);
  
  if (pattern1[0] !== pattern1[1] && 
      pattern1[1] === pattern1[2] && 
      pattern1[2] !== pattern1[3] &&
      pattern1[0] === pattern1[3]) {
    const weight = getPatternWeight(type, 'cau_121');
    return { 
      detected: true, 
      pattern: '1-2-1',
      prediction: pattern1[0],
      confidence: Math.round(10 * weight),
      name: 'Cầu 1-2-1',
      patternId: 'cau_121'
    };
  }
  
  return { detected: false };
}

function analyzeCau123(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first = results[5];
  const nextTwo = results.slice(3, 5);
  const lastThree = results.slice(0, 3);
  
  if (nextTwo[0] === nextTwo[1] && nextTwo[0] !== first) {
    const allSame = lastThree.every(r => r === lastThree[0]);
    if (allSame && lastThree[0] !== nextTwo[0]) {
      const weight = getPatternWeight(type, 'cau_123');
      return { 
        detected: true, 
        pattern: '1-2-3',
        prediction: first,
        confidence: Math.round(11 * weight),
        name: 'Cầu 1-2-3',
        patternId: 'cau_123'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau321(results, type) {
  if (results.length < 6) return { detected: false };
  
  const first3 = results.slice(3, 6);
  const next2 = results.slice(1, 3);
  const last1 = results[0];
  
  const first3Same = first3.every(r => r === first3[0]);
  const next2Same = next2.every(r => r === next2[0]);
  
  if (first3Same && next2Same && first3[0] !== next2[0] && last1 !== next2[0]) {
    const weight = getPatternWeight(type, 'cau_321');
    return { 
      detected: true, 
      pattern: '3-2-1',
      prediction: next2[0],
      confidence: Math.round(12 * weight),
      name: 'Cầu 3-2-1',
      patternId: 'cau_321'
    };
  }
  
  return { detected: false };
}

function analyzeCauNhayCoc(results, type) {
  if (results.length < 6) return { detected: false };
  
  const skipPattern = [];
  for (let i = 0; i < Math.min(results.length, 12); i += 2) {
    skipPattern.push(results[i]);
  }
  
  if (skipPattern.length >= 3) {
    const weight = getPatternWeight(type, 'cau_nhay_coc');
    const allSame = skipPattern.slice(0, 3).every(r => r === skipPattern[0]);
    if (allSame) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0],
        confidence: Math.round(8 * weight),
        name: 'Cầu Nhảy Cóc',
        patternId: 'cau_nhay_coc'
      };
    }
    
    let alternating = true;
    for (let i = 1; i < skipPattern.length - 1; i++) {
      if (skipPattern[i] === skipPattern[i - 1]) {
        alternating = false;
        break;
      }
    }
    
    if (alternating && skipPattern.length >= 3) {
      return { 
        detected: true, 
        pattern: skipPattern.slice(0, 3),
        prediction: skipPattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(7 * weight),
        name: 'Cầu Nhảy Cóc Đảo',
        patternId: 'cau_nhay_coc'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauNhipNghieng(results, type) {
  if (results.length < 5) return { detected: false };
  
  const last5 = results.slice(0, 5);
  const taiCount5 = last5.filter(r => r === 'Tài').length;
  const weight = getPatternWeight(type, 'cau_nhip_nghieng');
  
  if (taiCount5 >= 4) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      ratio: `${taiCount5}/5 Tài`,
      prediction: 'Tài',
      confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${taiCount5} Tài)`,
      patternId: 'cau_nhip_nghieng'
    };
  } else if (taiCount5 <= 1) {
    return { 
      detected: true, 
      type: 'nghieng_5',
      ratio: `${5 - taiCount5}/5 Xỉu`,
      prediction: 'Xỉu',
      confidence: Math.round(9 * weight),
      name: `Cầu Nhịp Nghiêng 5 (${5 - taiCount5} Xỉu)`,
      patternId: 'cau_nhip_nghieng'
    };
  }
  
  if (results.length >= 7) {
    const last7 = results.slice(0, 7);
    const taiCount7 = last7.filter(r => r === 'Tài').length;
    
    if (taiCount7 >= 5) {
      return { 
        detected: true, 
        type: 'nghieng_7',
        ratio: `${taiCount7}/7 Tài`,
        prediction: 'Tài',
        confidence: Math.round(10 * weight),
        name: `Cầu Nhịp Nghiêng 7 (${taiCount7} Tài)`,
        patternId: 'cau_nhip_nghieng'
      };
    } else if (taiCount7 <= 2) {
      return { 
        detected: true, 
        type: 'nghieng_7',
        ratio: `${7 - taiCount7}/7 Xỉu`,
        prediction: 'Xỉu',
        confidence: Math.round(10 * weight),
        name: `Cầu Nhịp Nghiêng 7 (${7 - taiCount7} Xỉu)`,
        patternId: 'cau_nhip_nghieng'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCau3Van1(results, type) {
  if (results.length < 4) return { detected: false };
  
  const last4 = results.slice(0, 4);
  const taiCount = last4.filter(r => r === 'Tài').length;
  
  if (taiCount === 3) {
    const xiuIndex = last4.findIndex(r => r === 'Xỉu');
    if (xiuIndex === 3) {
      const weight = getPatternWeight(type, 'cau_3van1');
      return { 
        detected: true, 
        pattern: '3-1',
        prediction: 'Tài',
        confidence: Math.round(8 * weight),
        name: 'Cầu 3 Ván 1 (3T-1X)',
        patternId: 'cau_3van1'
      };
    }
  } else if (taiCount === 1) {
    const taiIndex = last4.findIndex(r => r === 'Tài');
    if (taiIndex === 3) {
      const weight = getPatternWeight(type, 'cau_3van1');
      return { 
        detected: true, 
        pattern: '3-1',
        prediction: 'Xỉu',
        confidence: Math.round(8 * weight),
        name: 'Cầu 3 Ván 1 (3X-1T)',
        patternId: 'cau_3van1'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauBeCau(results, type) {
  if (results.length < 5) return { detected: false };
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 4) {
    const weight = getPatternWeight(type, 'cau_be_cau');
    return { 
      detected: true, 
      streakLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(14, streakLength * 2 + 4) * weight),
      name: `Cầu Bẻ Cầu (${streakLength} phiên ${results[0]})`,
      patternId: 'cau_be_cau'
    };
  }
  
  return { detected: false };
}

function analyzeCauTuNhien(results, type) {
  const last10 = results.slice(0, Math.min(10, results.length));
  const taiCount = last10.filter(r => r === 'Tài').length;
  const xiuCount = last10.length - taiCount;
  
  const weight = getPatternWeight(type, 'cau_tu_nhien');
  const prediction = taiCount > xiuCount ? 'Tài' : 'Xỉu';
  
  return {
    detected: true,
    prediction,
    confidence: Math.round(5 * weight),
    name: `Cầu Tự Nhiên (${taiCount}T-${xiuCount}X)`,
    patternId: 'cau_tu_nhien'
  };
}

function analyzeCau44(results, type) {
  if (results.length < 8) return { detected: false };
  
  let quadCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 3) {
    if (results[i] === results[i + 1] && 
        results[i + 1] === results[i + 2] && 
        results[i + 2] === results[i + 3]) {
      pattern.push(results[i]);
      quadCount++;
      i += 4;
    } else {
      break;
    }
  }
  
  if (quadCount >= 1) {
    const currentPosition = (results.length - (quadCount * 4));
    const lastQuadType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_44');
    
    let prediction;
    if (currentPosition >= 3) {
      prediction = lastQuadType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastQuadType;
    }
    
    return { 
      detected: true, 
      quadCount,
      prediction,
      confidence: Math.round(Math.min(14, quadCount * 4 + 6) * weight),
      name: `Cầu 4-4 (${quadCount} bộ bốn)`,
      patternId: 'cau_44'
    };
  }
  
  return { detected: false };
}

function analyzeCau55(results, type) {
  if (results.length < 10) return { detected: false };
  
  let quintCount = 0;
  let i = 0;
  let pattern = [];
  
  while (i < results.length - 4) {
    if (results[i] === results[i + 1] && 
        results[i + 1] === results[i + 2] && 
        results[i + 2] === results[i + 3] &&
        results[i + 3] === results[i + 4]) {
      pattern.push(results[i]);
      quintCount++;
      i += 5;
    } else {
      break;
    }
  }
  
  if (quintCount >= 1) {
    const currentPosition = (results.length - (quintCount * 5));
    const lastQuintType = pattern[pattern.length - 1];
    const weight = getPatternWeight(type, 'cau_55');
    
    let prediction;
    if (currentPosition >= 4) {
      prediction = lastQuintType === 'Tài' ? 'Xỉu' : 'Tài';
    } else {
      prediction = lastQuintType;
    }
    
    return { 
      detected: true, 
      quintCount,
      prediction,
      confidence: Math.round(Math.min(15, quintCount * 5 + 7) * weight),
      name: `Cầu 5-5 (${quintCount} bộ năm)`,
      patternId: 'cau_55'
    };
  }
  
  return { detected: false };
}

function analyzeCau212(results, type) {
  if (results.length < 5) return { detected: false };
  
  const pattern = results.slice(0, 5);
  const weight = getPatternWeight(type, 'cau_212');
  
  if (pattern[0] === pattern[1] &&
      pattern[1] !== pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[0] !== pattern[2]) {
    return { 
      detected: true, 
      pattern: '2-1-2',
      prediction: pattern[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(10 * weight),
      name: 'Cầu 2-1-2',
      patternId: 'cau_212'
    };
  }
  
  return { detected: false };
}

function analyzeCau1221(results, type) {
  if (results.length < 6) return { detected: false };
  
  const pattern = results.slice(0, 6);
  const weight = getPatternWeight(type, 'cau_1221');
  
  if (pattern[0] !== pattern[1] &&
      pattern[1] === pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[4] === pattern[5] &&
      pattern[0] !== pattern[1]) {
    return { 
      detected: true, 
      pattern: '1-2-2-1',
      prediction: pattern[0],
      confidence: Math.round(11 * weight),
      name: 'Cầu 1-2-2-1',
      patternId: 'cau_1221'
    };
  }
  
  return { detected: false };
}

function analyzeCau2112(results, type) {
  if (results.length < 6) return { detected: false };
  
  const pattern = results.slice(0, 6);
  const weight = getPatternWeight(type, 'cau_2112');
  
  if (pattern[0] === pattern[1] &&
      pattern[1] !== pattern[2] &&
      pattern[2] === pattern[3] &&
      pattern[3] !== pattern[4] &&
      pattern[4] === pattern[5] &&
      pattern[0] !== pattern[2]) {
    return { 
      detected: true, 
      pattern: '2-1-1-2',
      prediction: pattern[0],
      confidence: Math.round(11 * weight),
      name: 'Cầu 2-1-1-2',
      patternId: 'cau_2112'
    };
  }
  
  return { detected: false };
}

function analyzeCauGap(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_gap');
  
  for (let gapSize = 2; gapSize <= 3; gapSize++) {
    let patternFound = true;
    const referenceType = results[0];
    
    for (let i = 0; i < Math.min(results.length, 12); i += (gapSize + 1)) {
      if (results[i] !== referenceType) {
        patternFound = false;
        break;
      }
    }
    
    if (patternFound) {
      return { 
        detected: true, 
        gapSize,
        prediction: referenceType,
        confidence: Math.round(9 * weight),
        name: `Cầu Gấp ${gapSize + 1} (mỗi ${gapSize + 1} phiên)`,
        patternId: 'cau_gap'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauZiczac(results, type) {
  if (results.length < 8) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_ziczac');
  
  let zigzagCount = 0;
  for (let i = 0; i < results.length - 2; i++) {
    if (results[i] !== results[i + 1] && results[i + 1] !== results[i + 2] && results[i] === results[i + 2]) {
      zigzagCount++;
    } else {
      break;
    }
  }
  
  if (zigzagCount >= 3) {
    return { 
      detected: true, 
      zigzagCount,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(13, zigzagCount * 2 + 5) * weight),
      name: `Cầu Ziczac (${zigzagCount} lần)`,
      patternId: 'cau_ziczac'
    };
  }
  
  return { detected: false };
}

function analyzeCauDoi(results, type) {
  if (results.length < 4) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_doi');
  
  let pairChanges = 0;
  let i = 0;
  
  while (i < results.length - 1) {
    if (results[i] === results[i + 1]) {
      pairChanges++;
      i += 2;
    } else {
      break;
    }
  }
  
  if (pairChanges >= 2) {
    const isAlternatingPairs = results[0] !== results[2];
    if (isAlternatingPairs) {
      return { 
        detected: true, 
        pairChanges,
        prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
        confidence: Math.round(Math.min(12, pairChanges * 3 + 4) * weight),
        name: `Cầu Đôi Đảo (${pairChanges} cặp)`,
        patternId: 'cau_doi'
      };
    } else {
      return { 
        detected: true, 
        pairChanges,
        prediction: results[0],
        confidence: Math.round(Math.min(11, pairChanges * 2 + 5) * weight),
        name: `Cầu Đôi Bệt (${pairChanges} cặp)`,
        patternId: 'cau_doi'
      };
    }
  }
  
  return { detected: false };
}

function analyzeCauRong(results, type) {
  if (results.length < 6) return { detected: false };
  
  const weight = getPatternWeight(type, 'cau_rong');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 6) {
    return { 
      detected: true, 
      streakLength,
      prediction: results[0] === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(Math.min(16, streakLength + 8) * weight),
      name: `Cầu Rồng ${streakLength} phiên (Bẻ mạnh)`,
      patternId: 'cau_rong'
    };
  }
  
  return { detected: false };
}

function analyzeSmartBet(results, type) {
  if (results.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'smart_bet');
  const last10 = results.slice(0, 10);
  const last5 = results.slice(0, 5);
  const prev5 = results.slice(5, 10);
  
  const taiLast5 = last5.filter(r => r === 'Tài').length;
  const taiPrev5 = prev5.filter(r => r === 'Tài').length;
  
  const trendChanging = (taiLast5 >= 4 && taiPrev5 <= 1) || (taiLast5 <= 1 && taiPrev5 >= 4);
  
  if (trendChanging) {
    const currentDominant = taiLast5 >= 4 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      trendChange: true,
      prediction: currentDominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(13 * weight),
      name: `Đảo Xu Hướng (${taiLast5}T-${5-taiLast5}X → ${taiPrev5}T-${5-taiPrev5}X)`,
      patternId: 'smart_bet'
    };
  }
  
  const taiLast10 = last10.filter(r => r === 'Tài').length;
  if (taiLast10 >= 8 || taiLast10 <= 2) {
    const dominant = taiLast10 >= 8 ? 'Tài' : 'Xỉu';
    return { 
      detected: true, 
      extreme: true,
      prediction: dominant === 'Tài' ? 'Xỉu' : 'Tài',
      confidence: Math.round(12 * weight),
      name: `Xu Hướng Cực (${taiLast10}T-${10-taiLast10}X trong 10 phiên)`,
      patternId: 'smart_bet'
    };
  }
  
  return { detected: false };
}

function analyzeDistribution(data, type, windowSize = 50) {
  const window = data.slice(0, windowSize);
  const taiCount = window.filter(d => d.Ket_qua === 'Tài').length;
  const xiuCount = window.length - taiCount;
  
  return {
    taiPercent: (taiCount / window.length) * 100,
    xiuPercent: (xiuCount / window.length) * 100,
    taiCount,
    xiuCount,
    total: window.length,
    imbalance: Math.abs(taiCount - xiuCount) / window.length
  };
}

function analyzeDicePatterns(data) {
  const recentData = data.slice(0, 15);
  
  let highDiceCount = 0;
  let lowDiceCount = 0;
  let totalSum = 0;
  let sumVariance = [];
  
  recentData.forEach(d => {
    const dices = [d.Xuc_xac_1, d.Xuc_xac_2, d.Xuc_xac_3];
    dices.forEach(dice => {
      if (dice >= 4) highDiceCount++;
      else lowDiceCount++;
    });
    totalSum += d.Tong;
    sumVariance.push(d.Tong);
  });
  
  const avgSum = totalSum / recentData.length;
  const variance = sumVariance.reduce((acc, val) => acc + Math.pow(val - avgSum, 2), 0) / sumVariance.length;
  const stdDev = Math.sqrt(variance);
  
  return {
    highDiceRatio: highDiceCount / (highDiceCount + lowDiceCount),
    lowDiceRatio: lowDiceCount / (highDiceCount + lowDiceCount),
    averageSum: avgSum,
    standardDeviation: stdDev,
    sumTrend: avgSum > 10.5 ? 'high' : 'low',
    isStable: stdDev < 3
  };
}

function analyzeSumTrend(data) {
  const recentSums = data.slice(0, 20).map(d => d.Tong);
  
  let increasingCount = 0;
  let decreasingCount = 0;
  
  for (let i = 0; i < recentSums.length - 1; i++) {
    if (recentSums[i] > recentSums[i + 1]) decreasingCount++;
    else if (recentSums[i] < recentSums[i + 1]) increasingCount++;
  }
  
  const movingAvg5 = recentSums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const movingAvg10 = recentSums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  
  return {
    trend: increasingCount > decreasingCount ? 'increasing' : 'decreasing',
    strength: Math.abs(increasingCount - decreasingCount) / (recentSums.length - 1),
    movingAvg5,
    movingAvg10,
    shortTermBias: movingAvg5 > 10.5 ? 'Tài' : 'Xỉu'
  };
}

function analyzeRecentMomentum(results) {
  const windows = [3, 5, 10, 15];
  const momentum = {};
  
  windows.forEach(size => {
    if (results.length >= size) {
      const window = results.slice(0, size);
      const taiCount = window.filter(r => r === 'Tài').length;
      momentum[`window_${size}`] = {
        taiRatio: taiCount / size,
        xiuRatio: (size - taiCount) / size,
        dominant: taiCount > size / 2 ? 'Tài' : 'Xỉu'
      };
    }
  });
  
  return momentum;
}

function detectCyclePattern(results, type) {
  if (results.length < 12) return { detected: false };
  
  for (let cycleLength = 2; cycleLength <= 6; cycleLength++) {
    let isRepeating = true;
    const pattern = results.slice(0, cycleLength);
    
    for (let i = cycleLength; i < Math.min(cycleLength * 3, results.length); i++) {
      if (results[i] !== pattern[i % cycleLength]) {
        isRepeating = false;
        break;
      }
    }
    
    if (isRepeating) {
      const nextPosition = results.length % cycleLength;
      const weight = getPatternWeight(type, 'cau_chu_ky');
      return { 
        detected: true, 
        cycleLength,
        pattern,
        prediction: pattern[nextPosition],
        confidence: Math.round(9 * weight),
        name: `Cầu Chu Kỳ ${cycleLength}`,
        patternId: 'cau_chu_ky'
      };
    }
  }
  
  return { detected: false };
}

function analyzeEdgeCases(data, type) {
  if (data.length < 10) return { detected: false };
  
  const recentTotals = data.slice(0, 10).map(d => d.Tong);
  
  const extremeHighCount = recentTotals.filter(t => t >= 14).length;
  const extremeLowCount = recentTotals.filter(t => t <= 7).length;
  const weight = getPatternWeight(type, 'edge_cases');
  
  if (extremeHighCount >= 4) {
    return { 
      detected: true, 
      type: 'extreme_high',
      prediction: 'Xỉu',
      confidence: Math.round(7 * weight),
      name: `Cực Điểm Cao (${extremeHighCount} phiên >= 14)`,
      patternId: 'edge_cases'
    };
  }
  
  if (extremeLowCount >= 4) {
    return { 
      detected: true, 
      type: 'extreme_low',
      prediction: 'Tài',
      confidence: Math.round(7 * weight),
      name: `Cực Điểm Thấp (${extremeLowCount} phiên <= 7)`,
      patternId: 'edge_cases'
    };
  }
  
  return { detected: false };
}

function analyzeDiceTrendLine(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const previousResult = previous.Ket_qua;
  const weight = getPatternWeight(type, 'dice_trend_line');
  
  const allSameDice = currentDices[0] === currentDices[1] && currentDices[1] === currentDices[2];
  if (allSameDice) {
    const prediction = currentDices[0] >= 4 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'same_dice',
      prediction,
      confidence: Math.round(13 * weight),
      name: `Biểu Đồ Đường (3 xúc xắc giống ${currentDices[0]})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const twoSameDice = (currentDices[0] === currentDices[1]) || 
                       (currentDices[1] === currentDices[2]) || 
                       (currentDices[0] === currentDices[2]);
  if (twoSameDice) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'two_same_dice',
      prediction,
      confidence: Math.round(11 * weight),
      name: `Biểu Đồ Đường (2 xúc xắc giống - Bẻ ${previousResult})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const maxDice = Math.max(...currentDices);
  const minDice = Math.min(...currentDices);
  if (maxDice === 6 && minDice === 1) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'extreme_range',
      prediction,
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (Biên độ max 6-1 - Bẻ)`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, maxDice, minDice, directions }
    };
  }
  
  if (upCount === 1 && downCount === 2) {
    return {
      detected: true,
      type: 'trend_1up_2down',
      prediction: 'Tài',
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (1 lên 2 xuống → Tài)`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (upCount === 2 && downCount === 1) {
    return {
      detected: true,
      type: 'trend_2up_1down',
      prediction: 'Xỉu',
      confidence: Math.round(12 * weight),
      name: `Biểu Đồ Đường (2 lên 1 xuống → Xỉu)`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (upCount === 3 || downCount === 3) {
    const prediction = previousResult;
    return {
      detected: true,
      type: 'all_same_direction',
      prediction,
      confidence: Math.round(10 * weight),
      name: `Biểu Đồ Đường (3 dây cùng ${upCount === 3 ? 'lên' : 'xuống'} → Theo ${previousResult})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  const twoSameDirection = (upCount === 2 && sameCount === 1) || 
                           (downCount === 2 && sameCount === 1) ||
                           (sameCount === 2 && (upCount === 1 || downCount === 1));
  if (twoSameDirection) {
    const prediction = previousResult === 'Tài' ? 'Xỉu' : 'Tài';
    const directionDesc = sameCount === 2 ? '2 dây ngang' : 
                         (upCount === 2 ? '2 dây lên' : '2 dây xuống');
    return {
      detected: true,
      type: 'two_same_direction',
      prediction,
      confidence: Math.round(10 * weight),
      name: `Biểu Đồ Đường (${directionDesc} → Bẻ ${previousResult})`,
      patternId: 'dice_trend_line',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  return { detected: false };
}

function analyzeDayGay(data, type) {
  if (data.length < 3) return { detected: false };
  
  const current = data[0];
  const previous = data[1];
  
  const currentDices = [current.Xuc_xac_1, current.Xuc_xac_2, current.Xuc_xac_3];
  const previousDices = [previous.Xuc_xac_1, previous.Xuc_xac_2, previous.Xuc_xac_3];
  
  const directions = [];
  for (let i = 0; i < 3; i++) {
    if (currentDices[i] > previousDices[i]) {
      directions.push('up');
    } else if (currentDices[i] < previousDices[i]) {
      directions.push('down');
    } else {
      directions.push('same');
    }
  }
  
  const upCount = directions.filter(d => d === 'up').length;
  const downCount = directions.filter(d => d === 'down').length;
  const sameCount = directions.filter(d => d === 'same').length;
  
  const weight = getPatternWeight(type, 'day_gay');
  
  if (sameCount === 2 && upCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      const sameValueDesc = `${sameDiceValues[0]}-${sameDiceValues[1]}`;
      
      return {
        detected: true,
        type: 'day_gay_2thang_1len',
        prediction: 'Xỉu',
        confidence: Math.round(14 * weight),
        name: `Dây Gãy (2 dây thẳng ${sameValueDesc} + 1 lên → Xỉu)`,
        patternId: 'day_gay',
        analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions, sameDiceValues }
      };
    }
  }
  
  if (sameCount === 2 && downCount === 1) {
    const sameIndices = directions.map((d, i) => d === 'same' ? i : -1).filter(i => i !== -1);
    const sameDiceValues = sameIndices.map(i => currentDices[i]);
    
    if (sameDiceValues[0] === sameDiceValues[1]) {
      const sameValueDesc = `${sameDiceValues[0]}-${sameDiceValues[1]}`;
      
      return {
        detected: true,
        type: 'day_gay_2thang_1xuong',
        prediction: 'Tài',
        confidence: Math.round(14 * weight),
        name: `Dây Gãy (2 dây thẳng ${sameValueDesc} + 1 xuống → Tài)`,
        patternId: 'day_gay',
        analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions, sameDiceValues }
      };
    }
  }
  
  if (upCount === 2 && downCount === 1) {
    return {
      detected: true,
      type: 'day_gay_2len_1xuong',
      prediction: 'Xỉu',
      confidence: Math.round(13 * weight),
      name: `Dây Gãy (2 lên 1 xuống → Xỉu)`,
      patternId: 'day_gay',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  if (downCount === 2 && upCount === 1) {
    return {
      detected: true,
      type: 'day_gay_2xuong_1len',
      prediction: 'Tài',
      confidence: Math.round(13 * weight),
      name: `Dây Gãy (2 xuống 1 lên → Tài)`,
      patternId: 'day_gay',
      analysis: { upCount, downCount, sameCount, currentDices, previousDices, directions }
    };
  }
  
  return { detected: false };
}

function analyzeBreakPattern(results, data, type) {
  if (results.length < 5) return { detected: false };
  
  const weight = getPatternWeight(type, 'break_pattern');
  
  let streakLength = 1;
  for (let i = 1; i < results.length; i++) {
    if (results[i] === results[0]) {
      streakLength++;
    } else {
      break;
    }
  }
  
  if (streakLength >= 5) {
    const current = data[0];
    const previous = data[1];
    
    const currentSum = current.Tong;
    const previousSum = previous.Tong;
    
    const sumDiff = Math.abs(currentSum - previousSum);
    
    if (sumDiff >= 5) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'break_after_streak',
        prediction,
        confidence: Math.round(15 * weight),
        name: `Cầu Liên Tục ${streakLength} (Biến động ${sumDiff} → Bẻ)`,
        patternId: 'break_pattern',
        analysis: { streakLength, currentSum, previousSum, sumDiff }
      };
    }
    
    if (streakLength >= 7) {
      const prediction = results[0] === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'long_streak_break',
        prediction,
        confidence: Math.round(16 * weight),
        name: `Cầu Liên Tục ${streakLength} (Streak dài → Bẻ mạnh)`,
        patternId: 'break_pattern',
        analysis: { streakLength }
      };
    }
  }
  
  return { detected: false };
}

function analyzeFibonacciPattern(data, type) {
  if (data.length < 13) return { detected: false };
  
  const weight = getPatternWeight(type, 'fibonacci');
  const fibPositions = [1, 2, 3, 5, 8, 13];
  
  let taiAtFib = 0;
  let xiuAtFib = 0;
  
  fibPositions.forEach(pos => {
    if (pos <= data.length) {
      const result = data[pos - 1].Ket_qua;
      if (result === 'Tài') taiAtFib++;
      else xiuAtFib++;
    }
  });
  
  if (taiAtFib >= 5 || xiuAtFib >= 5) {
    const dominant = taiAtFib > xiuAtFib ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      type: 'fibonacci_dominant',
      prediction: dominant,
      confidence: Math.round(11 * weight),
      name: `Fibonacci (${taiAtFib}T-${xiuAtFib}X tại vị trí Fib)`,
      patternId: 'fibonacci',
      analysis: { taiAtFib, xiuAtFib, fibPositions }
    };
  }
  
  return { detected: false };
}

function analyzeMomentumPattern(data, type) {
  if (data.length < 10) return { detected: false };
  
  const weight = getPatternWeight(type, 'momentum');
  const last5Sums = data.slice(0, 5).map(d => d.Tong);
  const prev5Sums = data.slice(5, 10).map(d => d.Tong);
  
  const avgLast5 = last5Sums.reduce((a, b) => a + b, 0) / 5;
  const avgPrev5 = prev5Sums.reduce((a, b) => a + b, 0) / 5;
  
  const momentumChange = avgLast5 - avgPrev5;
  
  if (Math.abs(momentumChange) >= 2) {
    const prediction = momentumChange > 0 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'momentum_shift',
      prediction,
      confidence: Math.round(12 * weight),
      name: `Momentum ${momentumChange > 0 ? 'Tăng' : 'Giảm'} (${avgLast5.toFixed(1)} vs ${avgPrev5.toFixed(1)})`,
      patternId: 'momentum',
      analysis: { avgLast5, avgPrev5, momentumChange }
    };
  }
  
  return { detected: false };
}

function analyzeResistanceSupport(data, type) {
  if (data.length < 20) return { detected: false };
  
  const weight = getPatternWeight(type, 'resistance_support');
  const sums = data.slice(0, 20).map(d => d.Tong);
  
  const maxSum = Math.max(...sums);
  const minSum = Math.min(...sums);
  const currentSum = data[0].Tong;
  
  const resistance = maxSum;
  const support = minSum;
  
  const distToResistance = resistance - currentSum;
  const distToSupport = currentSum - support;
  
  if (distToResistance <= 2 && distToResistance < distToSupport) {
    return {
      detected: true,
      type: 'near_resistance',
      prediction: 'Xỉu',
      confidence: Math.round(10 * weight),
      name: `Gần Kháng Cự (${currentSum} → ${resistance})`,
      patternId: 'resistance_support',
      analysis: { currentSum, resistance, distToResistance }
    };
  }
  
  if (distToSupport <= 2 && distToSupport < distToResistance) {
    return {
      detected: true,
      type: 'near_support',
      prediction: 'Tài',
      confidence: Math.round(10 * weight),
      name: `Gần Hỗ Trợ (${currentSum} → ${support})`,
      patternId: 'resistance_support',
      analysis: { currentSum, support, distToSupport }
    };
  }
  
  return { detected: false };
}

function analyzeWavePattern(data, type) {
  if (data.length < 12) return { detected: false };
  
  const weight = getPatternWeight(type, 'wave');
  const results = data.slice(0, 12).map(d => d.Ket_qua);
  
  let waves = [];
  let currentWave = { type: results[0], count: 1 };
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentWave.type) {
      currentWave.count++;
    } else {
      waves.push(currentWave);
      currentWave = { type: results[i], count: 1 };
    }
  }
  waves.push(currentWave);
  
  if (waves.length >= 4) {
    const waveLengths = waves.slice(0, 4).map(w => w.count);
    const isIncreasing = waveLengths.every((v, i, a) => i === 0 || v >= a[i - 1]);
    const isDecreasing = waveLengths.every((v, i, a) => i === 0 || v <= a[i - 1]);
    
    if (isIncreasing && waveLengths[0] < waveLengths[3]) {
      const prediction = waves[0].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'wave_expanding',
        prediction,
        confidence: Math.round(12 * weight),
        name: `Sóng Mở Rộng (${waveLengths.join('-')} → Bẻ ${prediction})`,
        patternId: 'wave',
        analysis: { waveLengths, pattern: 'expanding' }
      };
    }
    
    if (isDecreasing && waveLengths[0] > waveLengths[3]) {
      const prediction = waves[0].type;
      return {
        detected: true,
        type: 'wave_contracting',
        prediction,
        confidence: Math.round(11 * weight),
        name: `Sóng Thu Hẹp (${waveLengths.join('-')} → Theo ${prediction})`,
        patternId: 'wave',
        analysis: { waveLengths, pattern: 'contracting' }
      };
    }
  }
  
  if (waves.length >= 3) {
    const lastThreeWaves = waves.slice(0, 3);
    const avgWaveLength = lastThreeWaves.reduce((a, w) => a + w.count, 0) / 3;
    
    if (waves[0].count > avgWaveLength * 1.5) {
      const prediction = waves[0].type === 'Tài' ? 'Xỉu' : 'Tài';
      return {
        detected: true,
        type: 'wave_peak',
        prediction,
        confidence: Math.round(11 * weight),
        name: `Đỉnh Sóng (${waves[0].count} > avg ${avgWaveLength.toFixed(1)} → Bẻ)`,
        patternId: 'wave',
        analysis: { currentWaveLength: waves[0].count, avgWaveLength }
      };
    }
  }
  
  return { detected: false };
}

function analyzeGoldenRatio(data, type) {
  if (data.length < 21) return { detected: false };
  
  const weight = getPatternWeight(type, 'golden_ratio');
  const results = data.slice(0, 21);
  
  const goldenPositions = [1, 2, 3, 5, 8, 13, 21];
  let taiAtGolden = 0;
  let xiuAtGolden = 0;
  
  goldenPositions.forEach(pos => {
    if (pos <= results.length) {
      const result = results[pos - 1].Ket_qua;
      if (result === 'Tài') taiAtGolden++;
      else xiuAtGolden++;
    }
  });
  
  const ratio = Math.max(taiAtGolden, xiuAtGolden) / Math.min(taiAtGolden, xiuAtGolden);
  
  if (ratio >= 1.6 && ratio <= 1.7) {
    const dominant = taiAtGolden > xiuAtGolden ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      type: 'golden_ratio_detected',
      prediction: dominant,
      confidence: Math.round(12 * weight),
      name: `Tỷ Lệ Vàng (${taiAtGolden}T:${xiuAtGolden}X = ${ratio.toFixed(2)} → ${dominant})`,
      patternId: 'golden_ratio',
      analysis: { taiAtGolden, xiuAtGolden, ratio, goldenPositions }
    };
  }
  
  if (taiAtGolden >= 5 || xiuAtGolden >= 5) {
    const dominant = taiAtGolden > xiuAtGolden ? 'Tài' : 'Xỉu';
    const prediction = dominant === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'golden_extreme',
      prediction,
      confidence: Math.round(11 * weight),
      name: `Fibonacci Cực (${Math.max(taiAtGolden, xiuAtGolden)}/7 → Bẻ ${prediction})`,
      patternId: 'golden_ratio',
      analysis: { taiAtGolden, xiuAtGolden }
    };
  }
  
  return { detected: false };
}

function analyzeMarkovChain(results, data, type) {
  if (results.length < 20) return { detected: false };
  
  const transitions = {
    'Tài->Tài': 0, 'Tài->Xỉu': 0,
    'Xỉu->Tài': 0, 'Xỉu->Xỉu': 0
  };
  
  for (let i = 0; i < results.length - 1; i++) {
    const from = results[i + 1];
    const to = results[i];
    const key = `${from}->${to}`;
    transitions[key]++;
  }
  
  if (!learningData[type].transitionMatrix) {
    learningData[type].transitionMatrix = { ...transitions };
  } else {
    Object.keys(transitions).forEach(key => {
      learningData[type].transitionMatrix[key] = 
        (learningData[type].transitionMatrix[key] || 0) * 0.9 + transitions[key] * 0.1;
    });
  }
  
  const currentResult = results[0];
  const taiToTai = transitions['Tài->Tài'];
  const taiToXiu = transitions['Tài->Xỉu'];
  const xiuToTai = transitions['Xỉu->Tài'];
  const xiuToXiu = transitions['Xỉu->Xỉu'];
  
  let prediction, probability;
  
  if (currentResult === 'Tài') {
    const total = taiToTai + taiToXiu;
    if (total > 0) {
      probability = taiToTai / total;
      prediction = probability > 0.55 ? 'Tài' : 'Xỉu';
    } else {
      return { detected: false };
    }
  } else {
    const total = xiuToTai + xiuToXiu;
    if (total > 0) {
      probability = xiuToXiu / total;
      prediction = probability > 0.55 ? 'Xỉu' : 'Tài';
    } else {
      return { detected: false };
    }
  }
  
  const weight = getPatternWeight(type, 'markov_chain');
  const confidence = Math.round(Math.min(15, Math.abs(probability - 0.5) * 30 + 8) * weight);
  
  if (Math.abs(probability - 0.5) > 0.1) {
    return {
      detected: true,
      type: 'markov_transition',
      prediction,
      confidence,
      probability: (probability * 100).toFixed(1) + '%',
      name: `Markov Chain (${currentResult} → ${prediction}: ${(probability * 100).toFixed(0)}%)`,
      patternId: 'markov_chain',
      analysis: { transitions, currentResult, probability }
    };
  }
  
  return { detected: false };
}

function analyzeMovingAverageDrift(data, type) {
  if (data.length < 20) return { detected: false };
  
  const sums = data.slice(0, 20).map(d => d.Tong);
  
  const ma5 = sums.slice(0, 5).reduce((a, b) => a + b, 0) / 5;
  const ma10 = sums.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
  const ma20 = sums.reduce((a, b) => a + b, 0) / 20;
  
  const shortTermDrift = ma5 - ma10;
  const longTermDrift = ma10 - ma20;
  const totalDrift = ma5 - ma20;
  
  const weight = getPatternWeight(type, 'moving_avg_drift');
  
  if (Math.abs(shortTermDrift) > 1.5 && Math.abs(longTermDrift) > 1) {
    const momentum = shortTermDrift > 0 ? 'tăng' : 'giảm';
    const prediction = shortTermDrift > 0 ? 'Tài' : 'Xỉu';
    
    if (shortTermDrift * longTermDrift > 0) {
      return {
        detected: true,
        type: 'strong_drift',
        prediction,
        confidence: Math.round(14 * weight),
        name: `MA Drift Mạnh (MA5:${ma5.toFixed(1)} MA10:${ma10.toFixed(1)} → ${momentum})`,
        patternId: 'moving_avg_drift',
        analysis: { ma5, ma10, ma20, shortTermDrift, longTermDrift }
      };
    }
  }
  
  if (Math.abs(totalDrift) > 2) {
    const prediction = totalDrift > 0 ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'reversal_drift',
      prediction,
      confidence: Math.round(12 * weight),
      name: `MA Đảo Chiều (Drift: ${totalDrift.toFixed(1)} → Bẻ ${prediction})`,
      patternId: 'moving_avg_drift',
      analysis: { ma5, ma10, ma20, totalDrift }
    };
  }
  
  const ema5 = sums.slice(0, 5).reduce((acc, val, i) => {
    const multiplier = 2 / (5 + 1);
    return i === 0 ? val : val * multiplier + acc * (1 - multiplier);
  }, 0);
  
  if (Math.abs(ema5 - ma10) > 1.5) {
    const prediction = ema5 > ma10 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      type: 'ema_crossover',
      prediction,
      confidence: Math.round(11 * weight),
      name: `EMA Crossover (EMA5:${ema5.toFixed(1)} vs MA10:${ma10.toFixed(1)})`,
      patternId: 'moving_avg_drift',
      analysis: { ema5, ma10, diff: ema5 - ma10 }
    };
  }
  
  return { detected: false };
}

function analyzeSumPressure(data, type) {
  if (data.length < 15) return { detected: false };
  
  const EXPECTED_MEAN = 10.5;
  const recentSums = data.slice(0, 15).map(d => d.Tong);
  
  const avgSum = recentSums.reduce((a, b) => a + b, 0) / recentSums.length;
  const deviation = avgSum - EXPECTED_MEAN;
  
  const extremeHighCount = recentSums.filter(s => s >= 14).length;
  const extremeLowCount = recentSums.filter(s => s <= 7).length;
  const normalCount = recentSums.filter(s => s >= 9 && s <= 12).length;
  
  const volatility = recentSums.reduce((acc, s) => acc + Math.pow(s - avgSum, 2), 0) / recentSums.length;
  const stdDev = Math.sqrt(volatility);
  
  const weight = getPatternWeight(type, 'sum_pressure');
  
  if (Math.abs(deviation) > 1.5) {
    const pressure = deviation > 0 ? 'cao' : 'thấp';
    const prediction = deviation > 0 ? 'Xỉu' : 'Tài';
    
    return {
      detected: true,
      type: 'mean_reversion',
      prediction,
      confidence: Math.round(Math.min(15, Math.abs(deviation) * 5 + 7) * weight),
      name: `Áp Lực Tổng ${pressure.toUpperCase()} (Avg:${avgSum.toFixed(1)} vs Mean:${EXPECTED_MEAN})`,
      patternId: 'sum_pressure',
      analysis: { avgSum, deviation, expectedMean: EXPECTED_MEAN }
    };
  }
  
  if (extremeHighCount >= 4) {
    return {
      detected: true,
      type: 'extreme_high_pressure',
      prediction: 'Xỉu',
      confidence: Math.round(13 * weight),
      name: `Áp Lực Cực Cao (${extremeHighCount}/15 phiên >= 14)`,
      patternId: 'sum_pressure',
      analysis: { extremeHighCount, recentSums }
    };
  }
  
  if (extremeLowCount >= 4) {
    return {
      detected: true,
      type: 'extreme_low_pressure',
      prediction: 'Tài',
      confidence: Math.round(13 * weight),
      name: `Áp Lực Cực Thấp (${extremeLowCount}/15 phiên <= 7)`,
      patternId: 'sum_pressure',
      analysis: { extremeLowCount, recentSums }
    };
  }
  
  if (stdDev < 2 && normalCount >= 10) {
    const lastSum = recentSums[0];
    const prediction = lastSum > EXPECTED_MEAN ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'stable_zone',
      prediction,
      confidence: Math.round(10 * weight),
      name: `Vùng Ổn Định (StdDev:${stdDev.toFixed(1)}, Last:${lastSum})`,
      patternId: 'sum_pressure',
      analysis: { stdDev, normalCount, lastSum }
    };
  }
  
  return { detected: false };
}

function analyzeVolatility(data, type) {
  if (data.length < 10) return { detected: false };
  
  const sums = data.slice(0, 10).map(d => d.Tong);
  const changes = [];
  
  for (let i = 0; i < sums.length - 1; i++) {
    changes.push(Math.abs(sums[i] - sums[i + 1]));
  }
  
  const avgChange = changes.reduce((a, b) => a + b, 0) / changes.length;
  const maxChange = Math.max(...changes);
  const recentChange = changes[0];
  
  const weight = getPatternWeight(type, 'volatility');
  
  if (avgChange > 4 && maxChange >= 7) {
    const lastResult = data[0].Ket_qua;
    const prediction = lastResult === 'Tài' ? 'Xỉu' : 'Tài';
    return {
      detected: true,
      type: 'high_volatility',
      prediction,
      confidence: Math.round(12 * weight),
      name: `Biến Động Cao (Avg:${avgChange.toFixed(1)}, Max:${maxChange} → Bẻ)`,
      patternId: 'volatility',
      analysis: { avgChange, maxChange, recentChange }
    };
  }
  
  if (avgChange < 2 && recentChange >= 5) {
    const lastResult = data[0].Ket_qua;
    return {
      detected: true,
      type: 'volatility_spike',
      prediction: lastResult,
      confidence: Math.round(11 * weight),
      name: `Đột Biến Biến Động (Spike:${recentChange} vs Avg:${avgChange.toFixed(1)})`,
      patternId: 'volatility',
      analysis: { avgChange, recentChange }
    };
  }
  
  return { detected: false };
}

function analyzeSunHotCold(results, last50, type) {
  if (results.length < 10) return { detected: false };
  
  const last10 = results.slice(0, 10);
  const last20 = results.slice(0, Math.min(20, results.length));
  
  const taiCount10 = last10.filter(r => r === 'Tài').length;
  const xiuCount10 = 10 - taiCount10;
  
  const taiCount20 = last20.filter(r => r === 'Tài').length;
  const xiuCount20 = last20.length - taiCount20;
  
  const weight = getPatternWeight(type, 'sun_hot_cold');
  
  if (taiCount10 >= 7) {
    const hotStrength = taiCount10 / 10;
    return {
      detected: true,
      type: 'hot_tai',
      prediction: taiCount10 >= 8 ? 'Xỉu' : 'Tài',
      confidence: Math.round((taiCount10 >= 8 ? 14 : 12) * weight * hotStrength),
      name: `Sun Nóng Tài (${taiCount10}/10)`,
      patternId: 'sun_hot_cold'
    };
  } else if (xiuCount10 >= 7) {
    const hotStrength = xiuCount10 / 10;
    return {
      detected: true,
      type: 'hot_xiu',
      prediction: xiuCount10 >= 8 ? 'Tài' : 'Xỉu',
      confidence: Math.round((xiuCount10 >= 8 ? 14 : 12) * weight * hotStrength),
      name: `Sun Nóng Xỉu (${xiuCount10}/10)`,
      patternId: 'sun_hot_cold'
    };
  }
  
  const ratio20 = taiCount20 / last20.length;
  if (ratio20 >= 0.7 || ratio20 <= 0.3) {
    const dominant = ratio20 >= 0.5 ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      type: 'trend_20',
      prediction: dominant,
      confidence: Math.round(10 * weight),
      name: `Xu Hướng 20 Phiên (${dominant})`,
      patternId: 'sun_hot_cold'
    };
  }
  
  return { detected: false };
}

function analyzeSunStreakBreak(results, last50, type) {
  if (results.length < 5) return { detected: false };
  
  let currentStreak = 1;
  const currentType = results[0];
  
  for (let i = 1; i < results.length; i++) {
    if (results[i] === currentType) {
      currentStreak++;
    } else {
      break;
    }
  }
  
  const weight = getPatternWeight(type, 'sun_streak_break');
  
  if (currentStreak >= 4) {
    const sums = last50.slice(0, currentStreak).map(d => d.tong || 0).filter(s => s > 0);
    let avgSum = 10.5;
    if (sums.length > 0) {
      avgSum = sums.reduce((a, b) => a + b, 0) / sums.length;
    }
    
    const shouldBreak = currentStreak >= 5 || (avgSum <= 9 && currentType === 'Tài') || (avgSum >= 12 && currentType === 'Xỉu');
    
    return {
      detected: true,
      streakLength: currentStreak,
      streakType: currentType,
      prediction: shouldBreak ? (currentType === 'Tài' ? 'Xỉu' : 'Tài') : currentType,
      confidence: Math.round((shouldBreak ? Math.min(16, currentStreak * 2 + 4) : Math.min(14, currentStreak * 2)) * weight),
      name: `Sun Streak ${currentStreak} ${currentType} ${shouldBreak ? '(Bẻ)' : '(Tiếp)'}`,
      patternId: 'sun_streak_break'
    };
  }
  
  return { detected: false };
}

function analyzeSunBalance(results, type) {
  if (results.length < 15) return { detected: false };
  
  const last15 = results.slice(0, 15);
  const taiCount = last15.filter(r => r === 'Tài').length;
  const xiuCount = 15 - taiCount;
  
  const weight = getPatternWeight(type, 'sun_balance');
  
  const diff = Math.abs(taiCount - xiuCount);
  
  if (diff >= 7) {
    const minority = taiCount < xiuCount ? 'Tài' : 'Xỉu';
    return {
      detected: true,
      type: 'imbalance',
      prediction: minority,
      confidence: Math.round(Math.min(13, diff + 5) * weight),
      name: `Sun Cân Bằng (T:${taiCount} - X:${xiuCount})`,
      patternId: 'sun_balance'
    };
  }
  
  if (diff <= 1) {
    const last3 = results.slice(0, 3);
    const last3Tai = last3.filter(r => r === 'Tài').length;
    const prediction = last3Tai >= 2 ? 'Xỉu' : 'Tài';
    
    return {
      detected: true,
      type: 'balanced',
      prediction,
      confidence: Math.round(8 * weight),
      name: `Sun Cân Bằng Hoàn Hảo`,
      patternId: 'sun_balance'
    };
  }
  
  return { detected: false };
}

function analyzeSunMomentumShift(results, last50, type) {
  if (results.length < 12) return { detected: false };
  
  const recent6 = results.slice(0, 6);
  const prev6 = results.slice(6, 12);
  
  const recentTai = recent6.filter(r => r === 'Tài').length;
  const prevTai = prev6.filter(r => r === 'Tài').length;
  
  const shift = recentTai - prevTai;
  
  if (Math.abs(shift) >= 4) {
    const shifting = shift > 0 ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'sun_momentum_shift');
    
    return {
      detected: true,
      type: 'momentum_shift',
      prediction: shifting,
      confidence: Math.round(Math.min(14, Math.abs(shift) * 2 + 4) * weight),
      name: `Sun Đổi Chiều → ${shifting}`,
      patternId: 'sun_momentum_shift'
    };
  }
  
  return { detected: false };
}

function applyAutoReversal(type, prediction) {
  const reversalState = learningData[type].reversalState;
  const streakAnalysis = learningData[type].streakAnalysis;
  
  if (!reversalState) {
    learningData[type].reversalState = {
      active: false,
      activatedAt: null,
      consecutiveLosses: 0,
      reversalCount: 0,
      lastReversalResult: null
    };
    return { prediction, reversed: false };
  }
  
  if (streakAnalysis.currentStreak <= -REVERSAL_THRESHOLD && !reversalState.active) {
    reversalState.active = true;
    reversalState.activatedAt = new Date().toISOString();
    reversalState.reversalCount++;
    console.log(`[Auto-Reversal] ACTIVATED! Streak: ${streakAnalysis.currentStreak}, Reversing predictions...`);
  }
  
  if (reversalState.active) {
    const reversedPrediction = prediction === 'Tài' ? 'Xỉu' : 'Tài';
    console.log(`[Auto-Reversal] Reversing: ${prediction} → ${reversedPrediction}`);
    return { 
      prediction: reversedPrediction, 
      reversed: true,
      originalPrediction: prediction
    };
  }
  
  return { prediction, reversed: false };
}

function updateReversalState(type, isCorrect) {
  const reversalState = learningData[type].reversalState;
  
  if (!reversalState) return;
  
  if (isCorrect && reversalState.active) {
    console.log(`[Auto-Reversal] DEACTIVATED! Win detected, returning to normal mode.`);
    reversalState.active = false;
    reversalState.lastReversalResult = 'success';
    reversalState.consecutiveLosses = 0;
  }
  
  if (!isCorrect) {
    reversalState.consecutiveLosses++;
  } else {
    reversalState.consecutiveLosses = 0;
  }
}

function calculateAdvancedPrediction(data, type) {
  const last50 = data.slice(0, 50);
  const results = last50.map(d => d.Ket_qua);
  
  initializePatternStats(type);
  
  let predictions = [];
  let factors = [];
  let allPatterns = [];
  
  const cauBet = analyzeCauBet(results, type);
  if (cauBet.detected) {
    predictions.push({ prediction: cauBet.prediction, confidence: cauBet.confidence, priority: 10, name: cauBet.name });
    factors.push(cauBet.name);
    allPatterns.push(cauBet);
  }
  
  const cauDao11 = analyzeCauDao11(results, type);
  if (cauDao11.detected) {
    predictions.push({ prediction: cauDao11.prediction, confidence: cauDao11.confidence, priority: 9, name: cauDao11.name });
    factors.push(cauDao11.name);
    allPatterns.push(cauDao11);
  }
  
  const cau22 = analyzeCau22(results, type);
  if (cau22.detected) {
    predictions.push({ prediction: cau22.prediction, confidence: cau22.confidence, priority: 8, name: cau22.name });
    factors.push(cau22.name);
    allPatterns.push(cau22);
  }
  
  const cau33 = analyzeCau33(results, type);
  if (cau33.detected) {
    predictions.push({ prediction: cau33.prediction, confidence: cau33.confidence, priority: 8, name: cau33.name });
    factors.push(cau33.name);
    allPatterns.push(cau33);
  }
  
  const cau121 = analyzeCau121(results, type);
  if (cau121.detected) {
    predictions.push({ prediction: cau121.prediction, confidence: cau121.confidence, priority: 7, name: cau121.name });
    factors.push(cau121.name);
    allPatterns.push(cau121);
  }
  
  const cau123 = analyzeCau123(results, type);
  if (cau123.detected) {
    predictions.push({ prediction: cau123.prediction, confidence: cau123.confidence, priority: 7, name: cau123.name });
    factors.push(cau123.name);
    allPatterns.push(cau123);
  }
  
  const cau321 = analyzeCau321(results, type);
  if (cau321.detected) {
    predictions.push({ prediction: cau321.prediction, confidence: cau321.confidence, priority: 7, name: cau321.name });
    factors.push(cau321.name);
    allPatterns.push(cau321);
  }
  
  const cauNhayCoc = analyzeCauNhayCoc(results, type);
  if (cauNhayCoc.detected) {
    predictions.push({ prediction: cauNhayCoc.prediction, confidence: cauNhayCoc.confidence, priority: 6, name: cauNhayCoc.name });
    factors.push(cauNhayCoc.name);
    allPatterns.push(cauNhayCoc);
  }
  
  const cauNhipNghieng = analyzeCauNhipNghieng(results, type);
  if (cauNhipNghieng.detected) {
    predictions.push({ prediction: cauNhipNghieng.prediction, confidence: cauNhipNghieng.confidence, priority: 7, name: cauNhipNghieng.name });
    factors.push(cauNhipNghieng.name);
    allPatterns.push(cauNhipNghieng);
  }
  
  const cau3Van1 = analyzeCau3Van1(results, type);
  if (cau3Van1.detected) {
    predictions.push({ prediction: cau3Van1.prediction, confidence: cau3Van1.confidence, priority: 6, name: cau3Van1.name });
    factors.push(cau3Van1.name);
    allPatterns.push(cau3Van1);
  }
  
  const cauBeCau = analyzeCauBeCau(results, type);
  if (cauBeCau.detected) {
    predictions.push({ prediction: cauBeCau.prediction, confidence: cauBeCau.confidence, priority: 8, name: cauBeCau.name });
    factors.push(cauBeCau.name);
    allPatterns.push(cauBeCau);
  }
  
  const cyclePattern = detectCyclePattern(results, type);
  if (cyclePattern.detected) {
    predictions.push({ prediction: cyclePattern.prediction, confidence: cyclePattern.confidence, priority: 7, name: cyclePattern.name });
    factors.push(cyclePattern.name);
    allPatterns.push(cyclePattern);
  }
  
  const cau44 = analyzeCau44(results, type);
  if (cau44.detected) {
    predictions.push({ prediction: cau44.prediction, confidence: cau44.confidence, priority: 9, name: cau44.name });
    factors.push(cau44.name);
    allPatterns.push(cau44);
  }
  
  const cau55 = analyzeCau55(results, type);
  if (cau55.detected) {
    predictions.push({ prediction: cau55.prediction, confidence: cau55.confidence, priority: 9, name: cau55.name });
    factors.push(cau55.name);
    allPatterns.push(cau55);
  }
  
  const cau212 = analyzeCau212(results, type);
  if (cau212.detected) {
    predictions.push({ prediction: cau212.prediction, confidence: cau212.confidence, priority: 8, name: cau212.name });
    factors.push(cau212.name);
    allPatterns.push(cau212);
  }
  
  const cau1221 = analyzeCau1221(results, type);
  if (cau1221.detected) {
    predictions.push({ prediction: cau1221.prediction, confidence: cau1221.confidence, priority: 8, name: cau1221.name });
    factors.push(cau1221.name);
    allPatterns.push(cau1221);
  }
  
  const cau2112 = analyzeCau2112(results, type);
  if (cau2112.detected) {
    predictions.push({ prediction: cau2112.prediction, confidence: cau2112.confidence, priority: 8, name: cau2112.name });
    factors.push(cau2112.name);
    allPatterns.push(cau2112);
  }
  
  const cauGap = analyzeCauGap(results, type);
  if (cauGap.detected) {
    predictions.push({ prediction: cauGap.prediction, confidence: cauGap.confidence, priority: 7, name: cauGap.name });
    factors.push(cauGap.name);
    allPatterns.push(cauGap);
  }
  
  const cauZiczac = analyzeCauZiczac(results, type);
  if (cauZiczac.detected) {
    predictions.push({ prediction: cauZiczac.prediction, confidence: cauZiczac.confidence, priority: 8, name: cauZiczac.name });
    factors.push(cauZiczac.name);
    allPatterns.push(cauZiczac);
  }
  
  const cauDoi = analyzeCauDoi(results, type);
  if (cauDoi.detected) {
    predictions.push({ prediction: cauDoi.prediction, confidence: cauDoi.confidence, priority: 8, name: cauDoi.name });
    factors.push(cauDoi.name);
    allPatterns.push(cauDoi);
  }
  
  const cauRong = analyzeCauRong(results, type);
  if (cauRong.detected) {
    predictions.push({ prediction: cauRong.prediction, confidence: cauRong.confidence, priority: 10, name: cauRong.name });
    factors.push(cauRong.name);
    allPatterns.push(cauRong);
  }
  
  const smartBet = analyzeSmartBet(results, type);
  if (smartBet.detected) {
    predictions.push({ prediction: smartBet.prediction, confidence: smartBet.confidence, priority: 9, name: smartBet.name });
    factors.push(smartBet.name);
    allPatterns.push(smartBet);
  }
  
  const diceTrendLine = analyzeDiceTrendLine(last50, type);
  if (diceTrendLine.detected) {
    predictions.push({ prediction: diceTrendLine.prediction, confidence: diceTrendLine.confidence, priority: 11, name: diceTrendLine.name });
    factors.push(diceTrendLine.name);
    allPatterns.push(diceTrendLine);
  }
  
  const breakPattern = analyzeBreakPattern(results, last50, type);
  if (breakPattern.detected) {
    predictions.push({ prediction: breakPattern.prediction, confidence: breakPattern.confidence, priority: 12, name: breakPattern.name });
    factors.push(breakPattern.name);
    allPatterns.push(breakPattern);
  }
  
  const dayGay = analyzeDayGay(last50, type);
  if (dayGay.detected) {
    predictions.push({ prediction: dayGay.prediction, confidence: dayGay.confidence, priority: 13, name: dayGay.name });
    factors.push(dayGay.name);
    allPatterns.push(dayGay);
  }
  
  const distribution = analyzeDistribution(last50, type);
  if (distribution.imbalance > 0.2) {
    const minority = distribution.taiPercent < 50 ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'distribution');
    predictions.push({ prediction: minority, confidence: Math.round(6 * weight), priority: 5, name: 'Phân bố lệch' });
    factors.push(`Phân bố lệch (T:${distribution.taiPercent.toFixed(0)}% - X:${distribution.xiuPercent.toFixed(0)}%)`);
  }
  
  const dicePatterns = analyzeDicePatterns(last50);
  if (dicePatterns.averageSum > 11.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Xỉu', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB cao' });
    factors.push(`Tổng TB cao (${dicePatterns.averageSum.toFixed(1)})`);
  } else if (dicePatterns.averageSum < 9.5) {
    const weight = getPatternWeight(type, 'dice_pattern');
    predictions.push({ prediction: 'Tài', confidence: Math.round(5 * weight), priority: 4, name: 'Tổng TB thấp' });
    factors.push(`Tổng TB thấp (${dicePatterns.averageSum.toFixed(1)})`);
  }
  
  const sumTrend = analyzeSumTrend(last50);
  if (sumTrend.strength > 0.4) {
    const trendPrediction = sumTrend.trend === 'increasing' ? 'Tài' : 'Xỉu';
    const weight = getPatternWeight(type, 'sum_trend');
    predictions.push({ prediction: trendPrediction, confidence: Math.round(4 * weight), priority: 3, name: 'Xu hướng tổng' });
    factors.push(`Xu hướng tổng ${sumTrend.trend === 'increasing' ? 'tăng' : 'giảm'}`);
  }
  
  const edgeCases = analyzeEdgeCases(last50, type);
  if (edgeCases.detected) {
    predictions.push({ prediction: edgeCases.prediction, confidence: edgeCases.confidence, priority: 5, name: edgeCases.name });
    factors.push(edgeCases.name);
    allPatterns.push(edgeCases);
  }
  
  const momentum = analyzeRecentMomentum(results);
  if (momentum.window_3 && momentum.window_10) {
    const shortTermDiff = Math.abs(momentum.window_3.taiRatio - momentum.window_10.taiRatio);
    if (shortTermDiff > 0.3) {
      const reversePrediction = momentum.window_3.dominant === 'Tài' ? 'Xỉu' : 'Tài';
      const weight = getPatternWeight(type, 'momentum');
      predictions.push({ prediction: reversePrediction, confidence: Math.round(5 * weight), priority: 4, name: 'Biến động ngắn hạn' });
      factors.push('Biến động ngắn hạn mạnh');
    }
  }
  
  const fibonacciPattern = analyzeFibonacciPattern(last50, type);
  if (fibonacciPattern.detected) {
    predictions.push({ prediction: fibonacciPattern.prediction, confidence: fibonacciPattern.confidence, priority: 8, name: fibonacciPattern.name });
    factors.push(fibonacciPattern.name);
    allPatterns.push(fibonacciPattern);
  }
  
  const momentumPattern = analyzeMomentumPattern(last50, type);
  if (momentumPattern.detected) {
    predictions.push({ prediction: momentumPattern.prediction, confidence: momentumPattern.confidence, priority: 9, name: momentumPattern.name });
    factors.push(momentumPattern.name);
    allPatterns.push(momentumPattern);
  }
  
  const resistanceSupport = analyzeResistanceSupport(last50, type);
  if (resistanceSupport.detected) {
    predictions.push({ prediction: resistanceSupport.prediction, confidence: resistanceSupport.confidence, priority: 10, name: resistanceSupport.name });
    factors.push(resistanceSupport.name);
    allPatterns.push(resistanceSupport);
  }
  
  const wavePattern = analyzeWavePattern(last50, type);
  if (wavePattern.detected) {
    predictions.push({ prediction: wavePattern.prediction, confidence: wavePattern.confidence, priority: 8, name: wavePattern.name });
    factors.push(wavePattern.name);
    allPatterns.push(wavePattern);
  }
  
  const goldenRatio = analyzeGoldenRatio(last50, type);
  if (goldenRatio.detected) {
    predictions.push({ prediction: goldenRatio.prediction, confidence: goldenRatio.confidence, priority: 9, name: goldenRatio.name });
    factors.push(goldenRatio.name);
    allPatterns.push(goldenRatio);
  }
  
  const markovChain = analyzeMarkovChain(results, last50, type);
  if (markovChain.detected) {
    predictions.push({ prediction: markovChain.prediction, confidence: markovChain.confidence, priority: 12, name: markovChain.name });
    factors.push(markovChain.name);
    allPatterns.push(markovChain);
  }
  
  const movingAvgDrift = analyzeMovingAverageDrift(last50, type);
  if (movingAvgDrift.detected) {
    predictions.push({ prediction: movingAvgDrift.prediction, confidence: movingAvgDrift.confidence, priority: 11, name: movingAvgDrift.name });
    factors.push(movingAvgDrift.name);
    allPatterns.push(movingAvgDrift);
  }
  
  const sumPressure = analyzeSumPressure(last50, type);
  if (sumPressure.detected) {
    predictions.push({ prediction: sumPressure.prediction, confidence: sumPressure.confidence, priority: 11, name: sumPressure.name });
    factors.push(sumPressure.name);
    allPatterns.push(sumPressure);
  }
  
  const volatilityPattern = analyzeVolatility(last50, type);
  if (volatilityPattern.detected) {
    predictions.push({ prediction: volatilityPattern.prediction, confidence: volatilityPattern.confidence, priority: 10, name: volatilityPattern.name });
    factors.push(volatilityPattern.name);
    allPatterns.push(volatilityPattern);
  }
  
  const sunHotCold = analyzeSunHotCold(results, last50, type);
  if (sunHotCold.detected) {
    predictions.push({ prediction: sunHotCold.prediction, confidence: sunHotCold.confidence, priority: 13, name: sunHotCold.name });
    factors.push(sunHotCold.name);
    allPatterns.push(sunHotCold);
  }
  
  const sunStreakBreak = analyzeSunStreakBreak(results, last50, type);
  if (sunStreakBreak.detected) {
    predictions.push({ prediction: sunStreakBreak.prediction, confidence: sunStreakBreak.confidence, priority: 14, name: sunStreakBreak.name });
    factors.push(sunStreakBreak.name);
    allPatterns.push(sunStreakBreak);
  }
  
  const sunBalance = analyzeSunBalance(results, type);
  if (sunBalance.detected) {
    predictions.push({ prediction: sunBalance.prediction, confidence: sunBalance.confidence, priority: 12, name: sunBalance.name });
    factors.push(sunBalance.name);
    allPatterns.push(sunBalance);
  }
  
  const sunMomentumShift = analyzeSunMomentumShift(results, last50, type);
  if (sunMomentumShift.detected) {
    predictions.push({ prediction: sunMomentumShift.prediction, confidence: sunMomentumShift.confidence, priority: 13, name: sunMomentumShift.name });
    factors.push(sunMomentumShift.name);
    allPatterns.push(sunMomentumShift);
  }
  
  if (predictions.length === 0) {
    const cauTuNhien = analyzeCauTuNhien(results, type);
    predictions.push({ prediction: cauTuNhien.prediction, confidence: cauTuNhien.confidence, priority: 1, name: cauTuNhien.name });
    factors.push(cauTuNhien.name);
    allPatterns.push(cauTuNhien);
  }
  
  predictions.sort((a, b) => b.priority - a.priority || b.confidence - a.confidence);
  
  const taiVotes = predictions.filter(p => p.prediction === 'Tài');
  const xiuVotes = predictions.filter(p => p.prediction === 'Xỉu');
  
  const taiScore = taiVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  const xiuScore = xiuVotes.reduce((sum, p) => sum + p.confidence * p.priority, 0);
  
  let finalPrediction = taiScore >= xiuScore ? 'Tài' : 'Xỉu';
  
  finalPrediction = getSmartPredictionAdjustment(type, finalPrediction, allPatterns);
  
  let baseConfidence = 50;
  
  const topPredictions = predictions.slice(0, 3);
  topPredictions.forEach(p => {
    if (p.prediction === finalPrediction) {
      baseConfidence += p.confidence;
    }
  });
  
  const agreementRatio = (finalPrediction === 'Tài' ? taiVotes.length : xiuVotes.length) / predictions.length;
  baseConfidence += Math.round(agreementRatio * 10);
  
  const adaptiveBoost = getAdaptiveConfidenceBoost(type);
  baseConfidence += adaptiveBoost;
  
  const randomAdjust = (Math.random() * 4) - 2;
  let finalConfidence = Math.round(baseConfidence + randomAdjust);
  
  finalConfidence = Math.max(50, Math.min(85, finalConfidence));
  
  const reversalResult = applyAutoReversal(type, finalPrediction);
  const outputPrediction = reversalResult.prediction;
  
  if (reversalResult.reversed) {
    factors.unshift(`🔄 Auto-Reversal (${reversalResult.originalPrediction} → ${outputPrediction})`);
  }
  
  return {
    prediction: outputPrediction,
    confidence: finalConfidence,
    factors,
    allPatterns,
    reversed: reversalResult.reversed,
    originalPrediction: reversalResult.originalPrediction || null,
    detailedAnalysis: {
      totalPatterns: predictions.length,
      taiVotes: taiVotes.length,
      xiuVotes: xiuVotes.length,
      taiScore,
      xiuScore,
      topPattern: predictions[0]?.name || 'N/A',
      distribution,
      dicePatterns,
      sumTrend,
      adaptiveBoost,
      reversalState: learningData[type].reversalState,
      learningStats: {
        totalPredictions: learningData[type].totalPredictions,
        correctPredictions: learningData[type].correctPredictions,
        accuracy: learningData[type].totalPredictions > 0 
          ? (learningData[type].correctPredictions / learningData[type].totalPredictions * 100).toFixed(1) + '%'
          : 'N/A',
        currentStreak: learningData[type].streakAnalysis.currentStreak,
        bestStreak: learningData[type].streakAnalysis.bestStreak,
        worstStreak: learningData[type].streakAnalysis.worstStreak
      }
    }
  };
}

function savePredictionToHistory(type, phien, prediction, confidence) {
  const record = {
    phien_hien_tai: phien.toString(),
    du_doan: normalizeResult(prediction),
    ti_le: `${confidence}%`,
    id: '@tiendataox',
    timestamp: new Date().toISOString()
  };
  
  predictionHistory[type].unshift(record);
  
  if (predictionHistory[type].length > MAX_HISTORY) {
    predictionHistory[type] = predictionHistory[type].slice(0, MAX_HISTORY);
  }
  
  return record;
}

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send('t.me/CuTools - Sun Prediction API');
});

app.get('/sun', async (req, res) => {
  try {
    const data = await fetchData();
    if (!data || !data.data || data.data.length === 0) {
      return res.status(500).json({ error: 'Không thể lấy dữ liệu' });
    }
    
    await verifyPredictions('b52', data.data);
    
    const sunData = data.data;
    const latestPhien = sunData[0].Phien;
    const nextPhien = latestPhien + 1;
    
    const result = calculateAdvancedPrediction(sunData, 'b52');
    
    savePredictionToHistory('b52', nextPhien, result.prediction, result.confidence);
    recordPrediction('b52', nextPhien, result.prediction, result.confidence, result.factors);
    
    res.json({
      phien_hien_tai: nextPhien.toString(),
      du_doan: normalizeResult(result.prediction),
      ti_le: `${result.confidence}%`,
      id: '@tiendataox'
    });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Lỗi server' });
  }
});

app.get('/sun/lichsu', async (req, res) => {
  try {
    const data = await fetchData();
    if (data && data.data) {
      await verifyPredictions('b52', data.data);
    }
    
    const historyWithStatus = predictionHistory.b52.map(record => {
      const prediction = learningData.b52.predictions.find(p => p.phien === record.phien);
      
      let status = null;
      let ket_qua_thuc_te = null;
      
      if (prediction && prediction.verified) {
        status = prediction.isCorrect ? '✅' : '❌';
        ket_qua_thuc_te = prediction.actual;
      }
      
      return {
        ...record,
        ket_qua_thuc_te,
        status
      };
    });
    
    res.json({
      type: 'Sun Tài Xỉu',
      history: historyWithStatus,
      total: historyWithStatus.length
    });
  } catch (error) {
    res.json({
      type: 'Sun Tài Xỉu',
      history: predictionHistory.b52,
      total: predictionHistory.b52.length,
      error: 'Không thể cập nhật trạng thái'
    });
  }
});

app.get('/stats', (req, res) => {
  const reversalState = learningData.b52.reversalState || { active: false, reversalCount: 0 };
  
  const stats = {
    sun: {
      totalPredictions: learningData.b52.totalPredictions,
      correctPredictions: learningData.b52.correctPredictions,
      accuracy: learningData.b52.totalPredictions > 0 
        ? (learningData.b52.correctPredictions / learningData.b52.totalPredictions * 100).toFixed(2) + '%'
        : 'N/A',
      currentStreak: learningData.b52.streakAnalysis.currentStreak,
      bestStreak: learningData.b52.streakAnalysis.bestStreak,
      worstStreak: learningData.b52.streakAnalysis.worstStreak,
      wins: learningData.b52.streakAnalysis.wins,
      losses: learningData.b52.streakAnalysis.losses,
      autoReversal: {
        active: reversalState.active,
        activatedAt: reversalState.activatedAt,
        totalReversals: reversalState.reversalCount,
        consecutiveLosses: reversalState.consecutiveLosses,
        threshold: REVERSAL_THRESHOLD
      },
      lastUpdate: learningData.b52.lastUpdate
    }
  };
  
  res.json(stats);
});

loadLearningData();
loadPredictionHistory();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Sun Prediction API running on port ${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET /sun - Get prediction for next Sun round');
  console.log('  GET /sun/lichsu - Get prediction history');
  console.log('  GET /stats - Get learning statistics');
  startAutoSaveTask();
});