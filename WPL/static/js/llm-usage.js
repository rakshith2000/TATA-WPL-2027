(function () {
  "use strict";

  var data = window.llmUsageData;
  if (!data) return;

  var colors = { input: "#bd1680", cached: "#f0a52b", output: "#583b9b" };
  var labels = { input: "Input (uncached)", cached: "Cached input", output: "Output" };
  var number = new Intl.NumberFormat();
  var money = function (value) {
    return "$" + Number(value || 0).toFixed(6);
  };
  var shortDate = function (value) {
    var date = new Date(value + "T00:00:00Z");
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  };
  var svgStart = '<svg viewBox="0 0 800 260" role="presentation" xmlns="http://www.w3.org/2000/svg">';
  var chartEnd = "</svg>";

  function chartGrid(maxValue, format) {
    var grid = "";
    for (var i = 0; i <= 4; i++) {
      var y = 206 - i * 44;
      var value = maxValue * i / 4;
      grid += '<line class="llm-axis" x1="58" y1="' + y + '" x2="786" y2="' + y + '"></line>';
      grid += '<text x="50" y="' + (y + 4) + '" text-anchor="end">' + format(value) + "</text>";
    }
    return grid;
  }

  function renderTokenTrend() {
    var target = document.getElementById("tokenTrend");
    var points = data.daily;
    var maxValue = Math.max.apply(null, points.map(function (p) { return p.total; }).concat([0]));
    if (!points.length || maxValue === 0) {
      target.innerHTML = svgStart + '<text class="llm-empty-chart" x="400" y="130" text-anchor="middle">No token usage in this period</text>' + chartEnd;
      return;
    }
    maxValue = Math.ceil(maxValue / 4) * 4 || 4;
    var step = 728 / points.length;
    var width = Math.min(20, step * 0.58);
    var svg = svgStart + chartGrid(maxValue, function (n) { return number.format(Math.round(n)); });
    points.forEach(function (point, index) {
      var x = 58 + index * step + (step - width) / 2;
      var y = 206;
      [["input", colors.input], ["cached", colors.cached], ["output", colors.output]].forEach(function (item) {
        var height = point[item[0]] / maxValue * 176;
        if (height > 0) {
          y -= height;
          svg += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + width.toFixed(2) + '" height="' + height.toFixed(2) + '" rx="2" fill="' + item[1] + '"><title>' +
            shortDate(point.date) + " · " + labels[item[0]] + ": " + number.format(point[item[0]]) + "</title></rect>";
        }
      });
      if (index % Math.max(1, Math.ceil(points.length / 7)) === 0 || index === points.length - 1) {
        svg += '<text x="' + (x + width / 2).toFixed(2) + '" y="230" text-anchor="middle">' + shortDate(point.date) + "</text>";
      }
    });
    target.innerHTML = svg + chartEnd;
  }

  function renderCostTrend() {
    var target = document.getElementById("costTrend");
    var points = data.daily;
    var values = points.map(function (p) { return p.input_cost + p.cache_cost + p.output_cost; });
    var maxValue = Math.max.apply(null, values.concat([0]));
    if (!points.length || maxValue === 0) {
      target.innerHTML = svgStart + '<text class="llm-empty-chart" x="400" y="130" text-anchor="middle">No spend in this period</text>' + chartEnd;
      return;
    }
    var upper = maxValue * 1.15;
    var step = points.length > 1 ? 728 / (points.length - 1) : 728;
    var coords = values.map(function (value, i) {
      return { x: 58 + (points.length > 1 ? i * step : 364), y: 206 - value / upper * 176 };
    });
    var path = coords.map(function (point, i) { return (i ? "L" : "M") + point.x + " " + point.y; }).join(" ");
    var area = path + " L " + coords[coords.length - 1].x + " 206 L " + coords[0].x + " 206 Z";
    var svg = svgStart + '<defs><linearGradient id="costFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#bd1680" stop-opacity=".24"/><stop offset="1" stop-color="#bd1680" stop-opacity="0"/></linearGradient></defs>';
    svg += chartGrid(upper, function (n) { return "$" + n.toFixed(6); });
    svg += '<path class="llm-area" d="' + area + '"></path><path class="llm-line" d="' + path + '"></path>';
    coords.forEach(function (point, i) {
      svg += '<circle class="llm-point" cx="' + point.x + '" cy="' + point.y + '" r="3.5"><title>' +
        shortDate(points[i].date) + ": " + money(values[i]) + "</title></circle>";
      if (i % Math.max(1, Math.ceil(points.length / 7)) === 0 || i === points.length - 1) {
        svg += '<text x="' + point.x + '" y="230" text-anchor="middle">' + shortDate(points[i].date) + "</text>";
      }
    });
    target.innerHTML = svg + chartEnd;
  }

  function renderTokenMix() {
    var target = document.getElementById("tokenMix");
    var legend = document.getElementById("tokenLegend");
    var entries = ["input", "cached", "output"].map(function (key) {
      return { key: key, value: data.token_totals[key] || 0 };
    });
    var total = entries.reduce(function (sum, entry) { return sum + entry.value; }, 0);
    if (!total) {
      target.innerHTML = '<svg viewBox="0 0 180 180" role="presentation"><circle class="llm-donut__track" cx="90" cy="90" r="64"></circle><text class="llm-donut__center" x="90" y="96">No data</text></svg>';
    } else {
      var circumference = 2 * Math.PI * 64;
      var offset = 0;
      var svg = '<svg viewBox="0 0 180 180" role="presentation"><circle class="llm-donut__track" cx="90" cy="90" r="64"></circle>';
      entries.forEach(function (entry) {
        var length = entry.value / total * circumference;
        svg += '<circle class="llm-donut__segment" cx="90" cy="90" r="64" stroke="' + colors[entry.key] +
          '" stroke-dasharray="' + length + " " + (circumference - length) + '" stroke-dashoffset="' + -offset + '"></circle>';
        offset += length;
      });
      svg += '<text class="llm-donut__center" x="90" y="96">' + number.format(total) + "</text></svg>";
      target.innerHTML = svg;
    }
    legend.innerHTML = entries.map(function (entry) {
      var share = total ? (entry.value / total * 100).toFixed(1) : "0.0";
      return '<div class="llm-legend__item"><span class="llm-legend__dot" style="background:' + colors[entry.key] +
        '"></span><span><strong>' + labels[entry.key] + '</strong><small>' + number.format(entry.value) +
        " · " + share + "%</small></span></div>";
    }).join("");
  }

  function renderCostBreakdown() {
    var target = document.getElementById("costBreakdown");
    var items = [
      { key: "input", label: "Input (uncached)", cost: data.cost_breakdown.input, tokens: data.token_totals.input, color: colors.input },
      { key: "cached", label: "Cached input", cost: data.cost_breakdown.cached, tokens: data.token_totals.cached, color: colors.cached },
      { key: "output", label: "Output", cost: data.cost_breakdown.output, tokens: data.token_totals.output, color: colors.output }
    ];
    var max = Math.max.apply(null, items.map(function (item) { return item.cost; }).concat([0]));
    target.innerHTML = items.map(function (item) {
      var width = max ? Math.max(item.cost ? 1 : 0, item.cost / max * 100) : 0;
      return '<div class="llm-cost-row"><span class="llm-cost-row__label">' + item.label +
        '</span><div class="llm-cost-row__track"><div class="llm-cost-row__fill" style="width:' + width +
        "%;background:" + item.color + '"></div></div><strong class="llm-cost-row__value">' +
        money(item.cost) + '</strong><small class="llm-cost-row__tokens">' + number.format(item.tokens) + " tokens</small></div>";
    }).join("");
  }

  renderTokenTrend();
  renderCostTrend();
  renderTokenMix();
  renderCostBreakdown();
}());
