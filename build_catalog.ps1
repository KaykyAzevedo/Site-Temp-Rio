$utf8 = New-Object System.Text.UTF8Encoding $false

# Read index.html as UTF-8
$indexContent = [System.IO.File]::ReadAllText("C:\Users\cherm\Desktop\SITE TEMPRIO\index.html", $utf8)

$images = Get-ChildItem -Path "C:\Users\cherm\Desktop\TEMP RIO\Temperos" -Filter "*.png"

# Generate grid HTML
$gridHtml = ""
foreach ($img in $images) {
    $name = $img.BaseName
    $gridHtml += @"
                    <div class="surface-card rounded-2xl overflow-hidden hover-lift group border border-borderSubtle flex flex-col fade-in shadow-lg hover:shadow-primary-500/10">
                        <div class="w-full aspect-[4/3] relative overflow-hidden bg-[#111111]">
                            <img src="./temperos/$($img.Name)" alt="$name" loading="lazy"
                                class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-700 ease-out">
                            <div class="absolute inset-0 bg-gradient-to-t from-[#1A1A1A] via-[#1A1A1A]/20 to-transparent opacity-90"></div>
                        </div>
                        <div class="p-6 pt-2 text-center bg-[#1A1A1A] relative z-10 flex flex-col justify-center items-center flex-1">
                            <h4 class="text-xl font-bold text-white uppercase tracking-wider">$name</h4>
                            <div class="w-8 h-1 bg-primary-500 mx-auto rounded-full mt-3 opacity-0 group-hover:opacity-100 group-hover:w-16 transition-all duration-500"></div>
                        </div>
                    </div>
"@ + "`n"
}

# Extract header from index (up to <main>)
$headerEnd = $indexContent.IndexOf("<main>") + 6
$header = $indexContent.Substring(0, $headerEnd)
$header = $header -replace 'id="hero-section"', 'id="hero-section-placeholder"'

# Extract footer from index (from </main>)
$footerStart = $indexContent.IndexOf("</main>")
$footer = $indexContent.Substring($footerStart)
$footer = $footer -replace 'href="#', 'href="index.html#'

# Create catalog section
$catalogSection = @"
        <!-- NAVBAR for internal pages -->
        <nav class="w-full flex items-center justify-between px-6 md:px-12 py-6 bg-[#0A0A0A] border-b border-borderSubtle relative z-20">
            <a href="index.html">
                <img src="./logo.png" alt="Temp Rio" class="h-8 md:h-12 w-auto object-contain">
            </a>
            <a href="https://wa.me/5521996203535" target="_blank"
                class="hidden md:inline-flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/70 hover:text-primary-400 transition-colors border border-white/10 hover:border-primary-500/40 px-5 py-2.5 rounded-full backdrop-blur-sm">
                <i class="fa-brands fa-whatsapp text-green-400"></i> Fale agora
            </a>
        </nav>

        <section id="catalogo" class="py-24 border-b border-borderSubtle bg-[#0A0A0A] text-white">
            <div class="max-w-7xl mx-auto px-6">
                <div class="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6 fade-in">
                    <div>
                        <h2 class="text-3xl md:text-5xl font-bold tracking-tight mb-4">Catálogo Completo</h2>
                        <p class="text-textSecondary font-light text-lg max-w-xl">Todos os nossos temperos 100% naturais. Encontre os sabores perfeitos para as suas receitas.</p>
                    </div>
                    <a href="index.html" class="text-primary-400 hover:text-primary-500 font-semibold flex items-center gap-2 group transition-colors">
                        <i class="fa-solid fa-arrow-left transform group-hover:-translate-x-1 transition-transform"></i> Voltar para Início
                    </a>
                </div>
                
                <div class="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
$gridHtml
                </div>
            </div>
        </section>
"@

$newContent = $header + "`n" + $catalogSection + "`n" + $footer
[System.IO.File]::WriteAllText("C:\Users\cherm\Desktop\SITE TEMPRIO\catalogo.html", $newContent, $utf8)
