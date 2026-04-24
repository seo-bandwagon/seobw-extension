// Pure-logic analysis helpers extracted from content.js for unit testability.
//
// Dual-export pattern: attaches to `self.SEOBWAnalysis` when running as a
// content script in the target tab (injected via chrome.scripting.executeScript),
// and exports via CommonJS when loaded by Vitest / Node.
//
// content.js destructures from self.SEOBWAnalysis at the top of its closure.
// Tests import via require('../../lib/content-analysis.js').

(function (factory) {
  var api = factory();
  if (typeof self !== 'undefined') {
    self.SEOBWAnalysis = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(function () {

  // ============================================
  // SEO scoring
  // ============================================

  function calculateSEOScore(content, meta, headings, links, images, technical) {
    let score = 100;
    const issues = [];

    // Title (15 points)
    if (!meta.title.text) {
      score -= 15;
      issues.push('Missing title');
    } else if (meta.title.length < 30) {
      score -= 8;
      issues.push('Title too short');
    } else if (meta.title.length > 60) {
      score -= 5;
      issues.push('Title too long');
    }

    // Meta description (15 points)
    if (!meta.description.text) {
      score -= 15;
      issues.push('Missing meta description');
    } else if (meta.description.length < 120) {
      score -= 8;
      issues.push('Description too short');
    } else if (meta.description.length > 160) {
      score -= 5;
      issues.push('Description too long');
    }

    // H1 (10 points)
    if (headings.h1.length === 0) {
      score -= 10;
      issues.push('Missing H1');
    } else if (headings.multipleH1) {
      score -= 5;
      issues.push('Multiple H1 tags');
    }

    // Images (10 points)
    if (images.total > 0) {
      const missingAltRatio = images.missingAlt.count / images.total;
      if (missingAltRatio > 0.5) {
        score -= 10;
        issues.push('Many images missing alt');
      } else if (missingAltRatio > 0) {
        score -= 5;
        issues.push('Some images missing alt');
      }
    }

    // Canonical (5 points)
    if (!meta.canonical) {
      score -= 5;
      issues.push('No canonical URL');
    }

    // Schema (10 points)
    if (meta.schema.length === 0) {
      score -= 10;
      issues.push('No structured data');
    }

    // Open Graph (5 points)
    if (!meta.openGraph.title) {
      score -= 5;
      issues.push('Missing Open Graph');
    }

    // Content length (10 points)
    if (content.wordCount < 300) {
      score -= 10;
      issues.push('Thin content');
    } else if (content.wordCount < 600) {
      score -= 5;
      issues.push('Light content');
    }

    // Internal links (5 points)
    if (links.internal.count < 3) {
      score -= 5;
      issues.push('Few internal links');
    }

    // Page size (5 points)
    if (technical.domElements > 2000) {
      score -= 5;
      issues.push('Large DOM');
    }

    // Readability (10 points)
    if (content.readability.fleschKincaid > 14) {
      score -= 5;
      issues.push('Hard to read');
    }

    return {
      score: Math.max(0, score),
      grade: getGrade(score),
      issues
    };
  }

  function getGrade(score) {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  }

  // ============================================
  // Text processing
  // ============================================

  function cleanText(text) {
    return text.replace(/\s+/g, ' ').replace(/[^\w\s.,!?;:'"()-]/g, '').trim();
  }

  function getWords(text) {
    return text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(function (w) { return w.length > 0; });
  }

  function countSentences(text) {
    const sentences = text.split(/[.!?]+/).filter(function (s) { return s.trim().length > 0; });
    return sentences.length || 1;
  }

  function countSyllables(word) {
    word = word.toLowerCase();
    if (word.length <= 3) return 1;
    word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '');
    word = word.replace(/^y/, '');
    const matches = word.match(/[aeiouy]{1,2}/g);
    return matches ? matches.length : 1;
  }

  function calculateReadability(text, words) {
    const sentences = countSentences(text);
    const syllables = words.reduce(function (sum, word) { return sum + countSyllables(word); }, 0);

    const fleschKincaid = words.length > 0
      ? (0.39 * (words.length / sentences)) + (11.8 * (syllables / words.length)) - 15.59
      : 0;

    const fleschEase = words.length > 0
      ? 206.835 - (1.015 * (words.length / sentences)) - (84.6 * (syllables / words.length))
      : 0;

    let level = 'College';
    if (fleschKincaid <= 5) level = 'Elementary';
    else if (fleschKincaid <= 8) level = 'Middle School';
    else if (fleschKincaid <= 12) level = 'High School';

    return {
      fleschKincaid: Math.max(0, Math.round(fleschKincaid * 10) / 10),
      fleschEase: Math.max(0, Math.min(100, Math.round(fleschEase * 10) / 10)),
      level
    };
  }

  // ============================================
  // Top words / phrases / n-grams
  // ============================================

  const DEFAULT_STOP_WORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
    'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those',
    'it', 'its', 'you', 'your', 'we', 'our', 'they', 'their', 'he', 'she',
    'him', 'her', 'his', 'i', 'me', 'my', 'what', 'which', 'who', 'whom',
    'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both', 'few',
    'more', 'most', 'other', 'some', 'such', 'no', 'not', 'only', 'same',
    'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here', 'there'
  ]);

  function getTopWords(words) {
    const counts = {};
    words.forEach(function (word) {
      if (word.length > 2 && !DEFAULT_STOP_WORDS.has(word)) {
        counts[word] = (counts[word] || 0) + 1;
      }
    });

    return Object.entries(counts)
      .map(function (entry) { return { word: entry[0], count: entry[1] }; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 30);
  }

  function getTopPhrases(words) {
    const phrases2 = {};
    const phrases3 = {};
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been', 'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would']);

    for (let i = 0; i < words.length - 1; i++) {
      if (!stopWords.has(words[i]) || !stopWords.has(words[i + 1])) {
        const p2 = words[i] + ' ' + words[i + 1];
        phrases2[p2] = (phrases2[p2] || 0) + 1;
      }
      if (i < words.length - 2 && (!stopWords.has(words[i]) || !stopWords.has(words[i + 2]))) {
        const p3 = words[i] + ' ' + words[i + 1] + ' ' + words[i + 2];
        phrases3[p3] = (phrases3[p3] || 0) + 1;
      }
    }

    const allPhrases = [].concat(
      Object.entries(phrases2).map(function (entry) { return { phrase: entry[0], count: entry[1] }; }),
      Object.entries(phrases3).map(function (entry) { return { phrase: entry[0], count: entry[1] }; })
    );

    return allPhrases
      .filter(function (p) { return p.count > 1; })
      .sort(function (a, b) { return b.count - a.count; })
      .slice(0, 30);
  }

  function buildNgramCounts(words, n, stopWords) {
    const counts = {};
    for (let i = 0; i <= words.length - n; i++) {
      const gram = words.slice(i, i + n).join(' ');
      if (n > 1 && stopWords) {
        const parts = gram.split(' ');
        if (parts.every(function (w) { return stopWords.has(w); })) continue;
      }
      counts[gram] = (counts[gram] || 0) + 1;
    }
    return counts;
  }

  function getTopN(counts, n) {
    return Object.entries(counts)
      .filter(function (entry) { return entry[1] >= 2; })
      .sort(function (a, b) { return b[1] - a[1]; })
      .slice(0, n)
      .map(function (entry) { return { phrase: entry[0], count: entry[1] }; });
  }

  return {
    calculateSEOScore: calculateSEOScore,
    getGrade: getGrade,
    cleanText: cleanText,
    getWords: getWords,
    countSentences: countSentences,
    countSyllables: countSyllables,
    calculateReadability: calculateReadability,
    getTopWords: getTopWords,
    getTopPhrases: getTopPhrases,
    buildNgramCounts: buildNgramCounts,
    getTopN: getTopN,
    DEFAULT_STOP_WORDS: DEFAULT_STOP_WORDS
  };
});
