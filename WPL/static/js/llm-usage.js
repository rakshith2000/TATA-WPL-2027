(function () {
  "use strict";

  var data = window.llmUsageData;
  if (!data) return;

  var colors = { input: "#bd1680", cached: "#f0a52b", output: "#583b9b" };
  var labels = { input: "Input (uncached)", cached: "Cached input", output: "Output" };
  var chartX = { start: 74, end: 786, top: 50, bottom: 292 };
  var chartWidth = chartX.end - chartX.start;
  var chartHeight = chartX.bottom - chartX.top;
  var number = new Intl.NumberFormat();
  var currency = "USD";
  var usdInrRate = null;
  var money = function (value) {
    var amount = Number(value || 0);
    if (currency === "INR" && usdInrRate) {
      return new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 6
      }).format(amount * usdInrRate);
    }
    return "$" + amount.toFixed(6);
  };
  var shortDate = function (value) {
    var date = new Date(value + "T00:00:00Z");
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
  };
  var svgStart = '<svg viewBox="0 0 800 360" role="presentation" xmlns="http://www.w3.org/2000/svg">';
  var chartEnd = "</svg>";

  function chartGrid(maxValue, format) {
    var grid = "";
    for (var i = 0; i <= 4; i++) {
      var y = chartX.bottom - i * chartHeight / 4;
      var value = maxValue * i / 4;
      grid += '<line class="llm-axis" x1="' + chartX.start + '" y1="' + y + '" x2="' + chartX.end + '" y2="' + y + '"></line>';
      grid += '<text x="66" y="' + (y + 4) + '" text-anchor="end">' + format(value) + "</text>";
    }
    return grid;
  }

  function attachChartInteraction(target, points, xForIndex, getRows) {
    var svg = target.querySelector("svg");
    if (!svg || !points.length) return;

    svg.insertAdjacentHTML("beforeend",
      '<rect class="llm-chart-hit-area" x="' + chartX.start + '" y="' + chartX.top +
      '" width="' + chartWidth + '" height="' + (chartX.bottom - chartX.top + 28) +
      '"></rect><line class="llm-crosshair" x1="0" y1="' + chartX.top +
      '" x2="0" y2="' + chartX.bottom + '"></line>'
    );
    var crosshair = svg.querySelector(".llm-crosshair");
    var tooltip = document.createElement("div");
    tooltip.className = "llm-chart-tooltip";
    tooltip.hidden = true;
    tooltip.setAttribute("role", "status");
    tooltip.setAttribute("aria-live", "polite");
    target.appendChild(tooltip);
    var lastPointerType = "mouse";

    function showValue(clientX, pointerType) {
      lastPointerType = pointerType || "mouse";
      var bounds = svg.getBoundingClientRect();
      if (!bounds.width) return;
      var viewX = (clientX - bounds.left) / bounds.width * 800;
      var index = 0;
      var minDistance = Infinity;
      points.forEach(function (point, candidate) {
        var distance = Math.abs(xForIndex(candidate) - viewX);
        if (distance < minDistance) {
          minDistance = distance;
          index = candidate;
        }
      });

      var x = xForIndex(index);
      crosshair.setAttribute("x1", x);
      crosshair.setAttribute("x2", x);
      crosshair.style.visibility = "visible";

      tooltip.replaceChildren();
      var date = document.createElement("strong");
      date.textContent = shortDate(points[index].date);
      tooltip.appendChild(date);
      getRows(points[index]).forEach(function (row) {
        var line = document.createElement("span");
        if (row.color) {
          var dot = document.createElement("i");
          dot.style.backgroundColor = row.color;
          line.appendChild(dot);
        }
        var label = document.createElement("span");
        label.textContent = row.label + ": " + row.value;
        line.appendChild(label);
        tooltip.appendChild(line);
      });

      var localX = x / 800 * bounds.width;
      var tooltipWidth = tooltip.offsetWidth || 180;
      var left = Math.max(4, Math.min(bounds.width - tooltipWidth - 4, localX - tooltipWidth / 2));
      tooltip.style.left = left + "px";
      tooltip.hidden = false;
    }

    svg.addEventListener("pointermove", function (event) {
      showValue(event.clientX, event.pointerType);
    });
    svg.addEventListener("pointerdown", function (event) {
      showValue(event.clientX, event.pointerType);
    });
    svg.addEventListener("pointerleave", function () {
      if (lastPointerType === "touch") return;
      crosshair.style.visibility = "hidden";
      tooltip.hidden = true;
    });
  }

  function renderTokenTrend() {
    var target = document.getElementById("tokenTrend");
    var points = data.daily;
    var maxValue = Math.max.apply(null, points.map(function (p) { return p.total; }).concat([0]));
    if (!points.length || maxValue === 0) {
      target.innerHTML = svgStart + '<text class="llm-empty-chart" x="400" y="180" text-anchor="middle">No token usage in this period</text>' + chartEnd;
      return;
    }
    maxValue = Math.ceil(maxValue / 4) * 4 || 4;
    var step = chartWidth / points.length;
    var width = Math.min(20, step * 0.58);
    var svg = svgStart + chartGrid(maxValue, function (n) { return number.format(Math.round(n)); });
    points.forEach(function (point, index) {
      var x = chartX.start + index * step + (step - width) / 2;
      var y = chartX.bottom;
      [["input", colors.input], ["cached", colors.cached], ["output", colors.output]].forEach(function (item) {
        var height = point[item[0]] / maxValue * chartHeight;
        if (height > 0) {
          y -= height;
          svg += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + width.toFixed(2) + '" height="' + height.toFixed(2) + '" rx="2" fill="' + item[1] + '"><title>' +
            shortDate(point.date) + " · " + labels[item[0]] + ": " + number.format(point[item[0]]) + "</title></rect>";
        }
      });
      if (index % Math.max(1, Math.ceil(points.length / 7)) === 0 || index === points.length - 1) {
        svg += '<text x="' + (x + width / 2).toFixed(2) + '" y="326" text-anchor="middle">' + shortDate(point.date) + "</text>";
      }
    });
    target.innerHTML = svg + chartEnd;
    attachChartInteraction(
      target,
      points,
      function (index) { return chartX.start + (index + 0.5) * step; },
      function (point) {
        return [
          { label: labels.input, value: number.format(point.input), color: colors.input },
          { label: labels.cached, value: number.format(point.cached), color: colors.cached },
          { label: labels.output, value: number.format(point.output), color: colors.output },
          { label: "Total", value: number.format(point.total) }
        ];
      }
    );
  }

  function renderCostTrend() {
    var target = document.getElementById("costTrend");
    var points = data.daily;
    var values = points.map(function (p) { return p.input_cost + p.cache_cost + p.output_cost; });
    var maxValue = Math.max.apply(null, values.concat([0]));
    if (!points.length || maxValue === 0) {
      target.innerHTML = svgStart + '<text class="llm-empty-chart" x="400" y="180" text-anchor="middle">No spend in this period</text>' + chartEnd;
      return;
    }
    var upper = maxValue * 1.15;
    var step = points.length > 1 ? chartWidth / (points.length - 1) : chartWidth;
    var coords = values.map(function (value, i) {
      return {
        x: chartX.start + (points.length > 1 ? i * step : chartWidth / 2),
        y: chartX.bottom - value / upper * chartHeight
      };
    });
    var path = coords.map(function (point, i) { return (i ? "L" : "M") + point.x + " " + point.y; }).join(" ");
    var area = path + " L " + coords[coords.length - 1].x + " " + chartX.bottom +
      " L " + coords[0].x + " " + chartX.bottom + " Z";
    var svg = svgStart + '<defs><linearGradient id="costFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#bd1680" stop-opacity=".24"/><stop offset="1" stop-color="#bd1680" stop-opacity="0"/></linearGradient></defs>';
    svg += chartGrid(upper, money);
    svg += '<path class="llm-area" d="' + area + '"></path><path class="llm-line" d="' + path + '"></path>';
    coords.forEach(function (point, i) {
      svg += '<circle class="llm-point" cx="' + point.x + '" cy="' + point.y + '" r="3.5"><title>' +
        shortDate(points[i].date) + ": " + money(values[i]) + "</title></circle>";
      if (i % Math.max(1, Math.ceil(points.length / 7)) === 0 || i === points.length - 1) {
        svg += '<text x="' + point.x + '" y="326" text-anchor="middle">' + shortDate(points[i].date) + "</text>";
      }
    });
    target.innerHTML = svg + chartEnd;
    attachChartInteraction(
      target,
      points,
      function (index) { return coords[index].x; },
      function (point) {
        var cost = point.input_cost + point.cache_cost + point.output_cost;
        return [{ label: "Estimated spend", value: money(cost), color: colors.input }];
      }
    );
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

  function updateCurrencyDisplay() {
    document.getElementById("totalCost").textContent = money(data.total_cost);
    document.getElementById("averageCost").textContent = money(data.average_cost);
    document.querySelectorAll(".llm-cost-value").forEach(function (element) {
      element.textContent = money(Number(element.getAttribute("data-usd")));
    });
    document.getElementById("dailyCostUnit").textContent = currency;
    document.getElementById("breakdownCostUnit").textContent = currency;
    renderCostTrend();
    renderCostBreakdown();
  }

  var currencyToggle = document.getElementById("currencyToggle");
  var exchangeRateStatus = document.getElementById("exchangeRate");
  currencyToggle.addEventListener("change", function () {
    if (!currencyToggle.checked) {
      currency = "USD";
      exchangeRateStatus.textContent = "Costs shown in USD";
      updateCurrencyDisplay();
      return;
    }

    currencyToggle.disabled = true;
    exchangeRateStatus.textContent = "Fetching current exchange rate...";
    fetch("/admin/llm-usage/exchange-rate", {
      headers: { Accept: "application/json" },
      credentials: "same-origin"
    })
      .then(function (response) {
        if (!response.ok) {
          return response.json().then(function (body) {
            throw new Error(body.error || "Unable to fetch the current USD/INR rate.");
          });
        }
        return response.json();
      })
      .then(function (body) {
        var rate = Number(body.rate);
        if (body.base !== "USD" || body.quote !== "INR" || !Number.isFinite(rate) || rate <= 0) {
          throw new Error("The exchange-rate response was invalid.");
        }
        usdInrRate = rate;
        currency = "INR";
        exchangeRateStatus.textContent = "1 USD = " +
          new Intl.NumberFormat("en-IN", { maximumFractionDigits: 4 }).format(rate) +
          " INR · forex-python";
        updateCurrencyDisplay();
      })
      .catch(function (error) {
        currencyToggle.checked = false;
        currency = "USD";
        exchangeRateStatus.textContent = error.message + " Showing USD.";
        updateCurrencyDisplay();
      })
      .finally(function () {
        currencyToggle.disabled = false;
      });
  });

  renderTokenTrend();
  renderTokenMix();
  updateCurrencyDisplay();
}());
